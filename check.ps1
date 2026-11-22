# Reliable pre-submit check for this entry on Windows.
#
# The kit CLI writes its ordinary progress ("kit ... verified N files",
# "repository ...", "transcripts ...") to STDERR. In Windows PowerShell, piping a
# native command's STDERR through `2>&1` while `$ErrorActionPreference = 'Stop'`
# turns those progress lines into terminating errors: the pipeline stops after the
# first one, the CLI is killed (LASTEXITCODE -1), and the truncated output holds no
# FAIL lines. A check that reports failure with no FAIL lines is that trap.
#
# `check --json` gives the CLI no log sink, so it writes no progress to STDERR.
# Start-Process with redirected streams also keeps both streams intact and
# preserves the CLI's real exit status. Everything is echoed on the PowerShell
# SUCCESS stream, so a caller that pipes this script through `2>&1` cannot trip
# the same trap one level up. Only genuine failures decide the exit status.
param(
  [string]$KitDir = $env:MAKEFUN_KIT_DIR,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$CliArgs
)

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$kitName = 'site-generator-speed-01-run-20261122-kit'
if (-not $KitDir) {
  $parent = Join-Path $repo '..'
  $grandparent = Join-Path $parent '..'
  foreach ($candidate in @((Join-Path $parent $kitName), (Join-Path $grandparent $kitName))) {
    if (Test-Path (Join-Path $candidate 'cli\makefun.mjs')) { $KitDir = $candidate; break }
  }
}
$cli = if ($KitDir) { Join-Path $KitDir 'cli\makefun.mjs' } else { '' }
if (-not $cli -or -not (Test-Path $cli)) {
  Write-Output 'makefun CLI not found; set MAKEFUN_KIT_DIR to the unpacked kit directory.'
  exit 2
}

$cliArguments = [System.Collections.Generic.List[string]]::new()
$cliArguments.Add($cli)
$cliArguments.Add('check')
$cliArguments.Add('--kit')
$cliArguments.Add('.')
$cliArguments.Add('--repo')
$cliArguments.Add($repo)
$transcripts = Join-Path $KitDir 'transcripts.tar.gz'
if ((Test-Path $transcripts) -and -not ($CliArgs -contains '--transcripts')) {
  $cliArguments.Add('--transcripts')
  $cliArguments.Add($transcripts)
}
if (-not ($CliArgs -contains '--json')) { $cliArguments.Add('--json') }
if ($CliArgs) { foreach ($a in $CliArgs) { $cliArguments.Add($a) } }

$outFile = Join-Path ([IO.Path]::GetTempPath()) ("mf-check-{0}.out" -f $PID)
$errFile = Join-Path ([IO.Path]::GetTempPath()) ("mf-check-{0}.err" -f $PID)
try {
  $proc = Start-Process -FilePath (Get-Command node).Source `
    -ArgumentList $cliArguments.ToArray() -WorkingDirectory $KitDir `
    -NoNewWindow -Wait -PassThru `
    -RedirectStandardOutput $outFile -RedirectStandardError $errFile
  $stdout = if (Test-Path $outFile) { Get-Content $outFile -Raw } else { '' }
  $stderr = if (Test-Path $errFile) { Get-Content $errFile -Raw } else { '' }
  if ($stderr) { Write-Output $stderr }

  $json = $null
  try { $json = $stdout | ConvertFrom-Json } catch { $json = $null }
  if ($null -eq $json) {
    # A different CLI version without --json: echo its real words verbatim.
    if ($stdout) { Write-Output $stdout }
    Write-Output ("check.ps1: CLI exit {0}; output was not JSON." -f $proc.ExitCode)
    exit 1
  }

  $counts = @{ pass = 0; fail = 0; skip = 0; submission = 0 }
  foreach ($check in @($json.checks)) {
    $tag = if ($check.status -eq 'submission') { 'at submission' } else { [string]$check.status }
    Write-Output (("{0,-14}{1,-24}{2}" -f $tag, [string]$check.check, [string]$check.reason))
    if ($check.fix) { Write-Output (("{0,-14}{1,-24}to pass: {2}" -f '', '', [string]$check.fix)) }
    if ($counts.ContainsKey([string]$check.status)) { $counts[[string]$check.status]++ }
  }
  foreach ($note in @($json.notes)) { Write-Output ("note: {0}" -f $note) }
  Write-Output ("{0} passed, {1} failed, {2} skipped, {3} checked at submission" -f `
    $counts.pass, $counts.fail, $counts.skip, $counts.submission)
  Write-Output ("check.ps1: CLI exit {0}; ok={1}." -f $proc.ExitCode, [string]$json.ok)

  $genuineFail = ($counts.fail -gt 0) -or ($json.ok -ne $true)
  if ($genuineFail -or $proc.ExitCode -ne 0) { exit 1 }
  exit 0
} finally {
  Remove-Item $outFile, $errFile -Force -ErrorAction SilentlyContinue
}
