param(
    [switch]$ForceReplace
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot

$sharedPaths = @(
    @{
        Path = Join-Path $repoRoot ".venv"
        Source = "E:\0CODE\graph-rag-agent\graph-rag-agent\QA_GRAPHRAG\.venv"
        Mode = "DirectoryLink"
    },
    @{
        Path = Join-Path $repoRoot "node_modules"
        Source = "E:\0CODE\graph-rag-agent\graph-rag-agent\QA_GRAPHRAG\node_modules"
        Mode = "DirectoryLink"
    },
    @{
        Path = Join-Path $repoRoot "runtime\node_modules"
        Source = "E:\0CODE\graph-rag-agent\graph-rag-agent\QA_GRAPHRAG\runtime\node_modules"
        Mode = "DirectoryLink"
    },
    @{
        Path = Join-Path $repoRoot ".env"
        Source = "E:\0CODE\graph-rag-agent\graph-rag-agent\QA_GRAPHRAG\.env"
        Mode = "FileCopy"
    },
	@{
		Path = Join-Path $repoRoot "runtime\.env"
		Source = "E:\0CODE\graph-rag-agent\graph-rag-agent\QA_GRAPHRAG\runtime\.env"
		Mode = "FileCopy"
    }
)

function Test-ReparsePoint {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return $false
    }

    $item = Get-Item -LiteralPath $Path -Force
    return [bool]($item.Attributes -band [IO.FileAttributes]::ReparsePoint)
}

function Remove-ExistingPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
}

function Ensure-ParentDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
}

function Ensure-DirectoryLink {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Source
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        throw "共享目录不存在: $Source"
    }

    Ensure-ParentDirectory -Path $Path

    if (Test-Path -LiteralPath $Path) {
        if (Test-ReparsePoint -Path $Path) {
            Write-Host "[skip] 已存在目录链接: $Path" -ForegroundColor Yellow
            return
        }

        if (-not $ForceReplace) {
            throw "目标位置已存在普通目录: $Path。可重新运行并加 -ForceReplace。"
        }

        Write-Host "[remove] 删除已有目录: $Path" -ForegroundColor Yellow
        Remove-ExistingPath -Path $Path
    }

    Write-Host "[link] $Path -> $Source" -ForegroundColor Cyan
    $output = cmd.exe /c "mklink /J `"$Path`" `"$Source`"" 2>&1
    if ($LASTEXITCODE -ne 0) {
        $details = ($output | Out-String).Trim()
        throw "创建目录链接失败: $Path`n$details"
    }
}

function Ensure-FileCopy {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Source
    )

    if (-not (Test-Path -LiteralPath $Source)) {
        throw "共享文件不存在: $Source"
    }

    Ensure-ParentDirectory -Path $Path

    if ((Test-Path -LiteralPath $Path) -and (Test-ReparsePoint -Path $Path)) {
        if (-not $ForceReplace) {
            throw "目标位置已存在文件链接: $Path。可重新运行并加 -ForceReplace。"
        }

        Write-Host "[remove] 删除已有文件链接: $Path" -ForegroundColor Yellow
        Remove-ExistingPath -Path $Path
    }

    Write-Host "[copy] $Source -> $Path" -ForegroundColor Cyan
    Copy-Item -LiteralPath $Source -Destination $Path -Force
}

Write-Host "Bootstrapping worktree shared environment..." -ForegroundColor Green
Write-Host "Repo root: $repoRoot" -ForegroundColor DarkGray

foreach ($entry in $sharedPaths) {
    switch ($entry.Mode) {
        "DirectoryLink" {
            Ensure-DirectoryLink -Path $entry.Path -Source $entry.Source
        }
        "FileCopy" {
            Ensure-FileCopy -Path $entry.Path -Source $entry.Source
        }
        default {
            throw "未知模式: $($entry.Mode)"
        }
    }
}

Write-Host ""
Write-Host "完成。当前 worktree 已链接共享目录，并复制 .env。" -ForegroundColor Green
