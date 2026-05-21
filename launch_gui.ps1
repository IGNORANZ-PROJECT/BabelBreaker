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
$requirementsFile = Join-Path $scriptDir "requirements-launcher.txt"

New-Item -ItemType Directory -Force -Path $runtimeDir, $uvHome, $cacheDir, $pythonInstallDir | Out-Null

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

try {
    Ensure-Uv
    Ensure-Venv

    Write-Host "Installing or refreshing launcher dependencies..."
    Invoke-Native -FilePath $uvExe -Arguments @("pip", "install", "--python", $venvDir, "-r", $requirementsFile)

    & $venvPython -m babel_breaker_app --gui
    $status = $LASTEXITCODE
    if ($status -ne 0) {
        Pause-AndExit -Message "Babel Breaker GUI failed to start." -Code $status
    }

    exit 0
}
catch {
    Pause-AndExit -Message $_.Exception.Message
}
