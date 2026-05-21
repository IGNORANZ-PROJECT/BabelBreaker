$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$runtimeDir = Join-Path $scriptDir ".babel_breaker_runtime"
$uvHome = Join-Path $runtimeDir "uv"
$uvExe = Join-Path $uvHome "uv.exe"
$cacheDir = Join-Path $runtimeDir "cache"
$pythonInstallDir = Join-Path $runtimeDir "python"
$venvDir = Join-Path $scriptDir ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$venvPythonw = Join-Path $venvDir "Scripts\pythonw.exe"
$requirementsFile = Join-Path $scriptDir "requirements-launcher.txt"
$logsDir = Join-Path $runtimeDir "logs"
$stdoutLog = Join-Path $logsDir "gui.stdout.log"
$stderrLog = Join-Path $logsDir "gui.stderr.log"

New-Item -ItemType Directory -Force -Path $runtimeDir, $uvHome, $cacheDir, $pythonInstallDir, $logsDir | Out-Null

$env:UV_CACHE_DIR = $cacheDir
$env:UV_PYTHON_INSTALL_DIR = $pythonInstallDir
$env:UV_PYTHON_NO_REGISTRY = "1"

function Pause-AndExit {
    param(
        [string]$Message,
        [int]$Code = 1
    )

    Write-Host ""
    Write-Host $Message
    Read-Host "Press Enter to close" | Out-Null
    exit $Code
}

function Invoke-Native {
    param(
        [string]$FilePath,
        [string[]]$Arguments
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed ($LASTEXITCODE): $FilePath $($Arguments -join ' ')"
    }
}

function Get-RecentGuiLog {
    $lines = @()

    if (Test-Path $stderrLog) {
        $lines += Get-Content $stderrLog -Tail 40 -ErrorAction SilentlyContinue
    }

    if ($lines.Count -eq 0 -and (Test-Path $stdoutLog)) {
        $lines += Get-Content $stdoutLog -Tail 40 -ErrorAction SilentlyContinue
    }

    return ($lines -join [Environment]::NewLine).Trim()
}

function Ensure-Uv {
    if (Test-Path $uvExe) {
        return
    }

    Write-Host "Installing local uv runtime..."
    $env:UV_UNMANAGED_INSTALL = $uvHome
    try {
        $installer = Invoke-RestMethod -Uri "https://astral.sh/uv/install.ps1" -ErrorAction Stop
        Invoke-Expression $installer
    }
    finally {
        Remove-Item Env:UV_UNMANAGED_INSTALL -ErrorAction SilentlyContinue
    }

    if (-not (Test-Path $uvExe)) {
        throw "uv.exe was not created in $uvHome"
    }
}

function Ensure-Venv {
    if (Test-Path $venvPython) {
        return
    }

    Write-Host "Preparing local Python environment..."
    $args = @("venv", $venvDir, "--python", "3.12", "--managed-python", "--relocatable")
    if (Test-Path $venvDir) {
        $args += "--clear"
    }
    Invoke-Native -FilePath $uvExe -Arguments $args
}

function Start-GuiDetached {
    if (Test-Path $stdoutLog) {
        Remove-Item $stdoutLog -Force
    }

    if (Test-Path $stderrLog) {
        Remove-Item $stderrLog -Force
    }

    $pythonLauncher = $venvPython
    if (Test-Path $venvPythonw) {
        $pythonLauncher = $venvPythonw
    }

    $process = Start-Process `
        -FilePath $pythonLauncher `
        -ArgumentList @("-m", "babel_breaker_app.main", "--gui") `
        -WorkingDirectory $scriptDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -PassThru

    Start-Sleep -Seconds 2
    $process.Refresh()

    if ($process.HasExited) {
        $recentLog = Get-RecentGuiLog
        if ($recentLog) {
            throw "Babel Breaker GUI failed to stay running.`n`n$recentLog"
        }
        throw "Babel Breaker GUI failed to stay running."
    }
}

try {
    Ensure-Uv
    Ensure-Venv

    Write-Host "Installing or refreshing launcher dependencies..."
    Invoke-Native -FilePath $uvExe -Arguments @("pip", "install", "--python", $venvDir, "-r", $requirementsFile)

    Start-GuiDetached
    exit 0
}
catch {
    Pause-AndExit -Message $_.Exception.Message
}
