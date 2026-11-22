# Reliable pre-submit check for this entry on Windows.
#
# The makefun CLI writes its ordinary progress ("kit ... verified N files",
# "repository ...", "transcripts ...") to STDERR. In Windows PowerShell, piping a
# native command's STDERR through `2>&1` while `$ErrorActionPreference = 'Stop'`
# turns those progress lines into terminating errors: the pipeline stops after the
# first one, the CLI never finishes, and the truncated output holds no FAIL lines.
# A check that reports failure with no FAIL lines is that trap, not a real failure.
#
# Start-Process with redirected streams keeps both streams intact and preserves
# the CLI's real exit status. Everything is echoed on the PowerShell SUCCESS
# stream, so a caller that pipes this script through `2>&1` cannot trip the same
# trap one level up. Only genuine FAIL lines are counted; none are suppressed.
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
  if ($stdout) { Write-Output $stdout }
  if ($stderr) { Write-Output $stderr }
  $all = ($stdout, $stderr) -join "`n"
  $lines = @($all -split "`r?`n")
  $fails = @($lines | Where-Object { $_ -match '^\s*FAIL\b' })
  Write-Output ("check.ps1: CLI exit {0}; {1} FAIL line(s)." -f $proc.ExitCode, $fails.Count)
  exit $proc.ExitCode
} finally {
  Remove-Item $outFile, $errFile -Force -ErrorAction SilentlyContinue
}
