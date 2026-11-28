# QD58 / 卓越·2026 - download and prepare locally hosted web fonts.
# Run from the repository root with: .\scripts\download-fonts.ps1
# This script only writes to assets/fonts and installs Python font tooling if missing.

[CmdletBinding()]
param(
    [switch]$SkipPythonInstall
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Support Windows PowerShell 5.1 TLS defaults.
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
    # PowerShell 7 / modern .NET may not expose the same setting.
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not (Test-Path (Join-Path $repoRoot 'index.html'))) {
    throw "未找到项目根目录 index.html。请将本脚本放在项目的 scripts\ 目录中。"
}

$fontDir = Join-Path $repoRoot 'assets\fonts'
New-Item -ItemType Directory -Path $fontDir -Force | Out-Null

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Download-VerifiedFile {
    param(
        [Parameter(Mandatory=$true)][string]$Url,
        [Parameter(Mandatory=$true)][string]$Destination,
        [Parameter(Mandatory=$true)][long]$MinimumBytes,
        [Parameter(Mandatory=$true)][string]$Description
    )

    $temporary = "$Destination.download"
    if (Test-Path $temporary) { Remove-Item $temporary -Force }

    $downloaded = $false
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Write-Host "下载：$Description（尝试 $attempt/3）"
            Invoke-WebRequest -Uri $Url -OutFile $temporary -UseBasicParsing -Headers @{ 'User-Agent' = 'QD58-Zhuoyue-Font-Setup/1.0' }
            $file = Get-Item $temporary
            if ($file.Length -lt $MinimumBytes) {
                throw "文件异常偏小：$($file.Length) bytes"
            }
            Move-Item -Path $temporary -Destination $Destination -Force
            $downloaded = $true
            break
        } catch {
            if (Test-Path $temporary) { Remove-Item $temporary -Force }
            if ($attempt -eq 3) {
                throw "下载 $Description 失败。请检查 GitHub 网络连接后重试。详情：$($_.Exception.Message)"
            }
            Start-Sleep -Seconds (2 * $attempt)
        }
    }
    if (-not $downloaded) { throw "下载 $Description 未完成。" }
}

function Assert-Woff2([string]$Path, [string]$Description) {
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $magic = New-Object byte[] 4
        [void]$stream.Read($magic, 0, 4)
        $signature = [System.Text.Encoding]::ASCII.GetString($magic)
        if ($signature -ne 'wOF2') {
            throw "$Description 不是有效的 WOFF2 文件（文件头：$signature）。"
        }
    } finally {
        $stream.Dispose()
    }
}

# Pinned official releases/commit to make this script repeatable.
$lxgwVersion = 'v1.530'
$lxgwTtfUrl = "https://github.com/lxgw/LxgwWenKai-Lite/releases/download/$lxgwVersion/LXGWWenKaiLite-Regular.ttf"
$lxgwLicenseUrl = "https://raw.githubusercontent.com/lxgw/LxgwWenKai-Lite/$lxgwVersion/OFL.txt"

# Adobe Source Han Sans release branch, pinned to the inspected 2.005R release commit.
$sourceHanCommit = 'a4f7cf94edfb9d7ffbdfc4841de276358bd7e0f2'
$sourceHanWoff2Url = "https://raw.githubusercontent.com/adobe-fonts/source-han-sans/$sourceHanCommit/Variable/WOFF2/TTF/Subset/SourceHanSansCN-VF.ttf.woff2"
$sourceHanLicenseUrl = "https://raw.githubusercontent.com/adobe-fonts/source-han-sans/$sourceHanCommit/LICENSE.txt"

$lxgwSource = Join-Path $env:TEMP 'LXGWWenKaiLite-Regular.ttf'
$lxgwOutput = Join-Path $fontDir 'lxgw-wenkai-lite-regular.woff2'
$sourceHanOutput = Join-Path $fontDir 'source-han-sans-cn-variable.woff2'
$lxgwLicense = Join-Path $fontDir 'OFL-LXGW-WenKai-Lite.txt'
$sourceHanLicense = Join-Path $fontDir 'OFL-Source-Han-Sans.txt'

Write-Step "获取霞鹜文楷 Lite $lxgwVersion 官方字体源文件"
Download-VerifiedFile -Url $lxgwTtfUrl -Destination $lxgwSource -MinimumBytes 5000000 -Description 'LXGW WenKai Lite Regular TTF'

Write-Step '检查 Python 字体转换工具'
$pythonCommand = Get-Command py -ErrorAction SilentlyContinue
$pythonPrefix = @('-3')
if (-not $pythonCommand) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    $pythonPrefix = @()
}
if (-not $pythonCommand) {
    throw '未找到 Python。请先安装 Python 3（安装时勾选 Add Python to PATH），然后重新运行本脚本。'
}
$pythonExe = $pythonCommand.Source

& $pythonExe @pythonPrefix -c 'import fontTools, brotli' 2>$null
if ($LASTEXITCODE -ne 0) {
    if ($SkipPythonInstall) {
        throw '缺少 fonttools 或 brotli。请执行：py -3 -m pip install --user fonttools brotli，然后重新运行。'
    }
    Write-Host '安装 fonttools 和 brotli（仅用于把 LXGW TTF 转为网页 WOFF2）…'
    & $pythonExe @pythonPrefix -m pip install --user --upgrade fonttools brotli
    if ($LASTEXITCODE -ne 0) { throw 'Python 依赖安装失败。请检查 pip 网络连接，或手动运行 py -3 -m pip install --user fonttools brotli。' }
}

$scriptsCandidates = @(
    (& $pythonExe @pythonPrefix -c "import sysconfig; print(sysconfig.get_path('scripts'))" | Select-Object -Last 1).Trim(),
    (& $pythonExe @pythonPrefix -c "import site, os; print(os.path.join(site.getuserbase(), 'Scripts'))" | Select-Object -Last 1).Trim()
) | Where-Object { $_ }
$subsetExe = $null
foreach ($scriptsDir in $scriptsCandidates) {
    $candidate = Join-Path $scriptsDir 'pyftsubset.exe'
    if (Test-Path $candidate) { $subsetExe = $candidate; break }
}
if (-not $subsetExe) {
    $subsetCommand = Get-Command pyftsubset -ErrorAction SilentlyContinue
    if ($subsetCommand) { $subsetExe = $subsetCommand.Source }
    else { throw "找不到 pyftsubset.exe。已检查 Python Scripts 目录：$($scriptsCandidates -join '; ')。请确认 fonttools 安装成功。" }
}

Write-Step '将霞鹜文楷 Lite 转换为 WOFF2（保留 Lite 字库全部字符）'
$lxgwTemporaryOutput = "$lxgwOutput.download"
if (Test-Path $lxgwTemporaryOutput) { Remove-Item $lxgwTemporaryOutput -Force }
& $subsetExe $lxgwSource "--output-file=$lxgwTemporaryOutput" --flavor=woff2 '--unicodes=*' "--layout-features=*" "--name-IDs=*" "--name-languages=*" --glyph-names --notdef-glyph --notdef-outline --recommended-glyphs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $lxgwTemporaryOutput)) {
    throw '霞鹜文楷 Lite 转换失败。字体输出未覆盖现有文件。'
}
Assert-Woff2 -Path $lxgwTemporaryOutput -Description '霞鹜文楷 Lite'
if ((Get-Item $lxgwTemporaryOutput).Length -lt 500000) {
    throw '霞鹜文楷 Lite WOFF2 文件异常偏小，已停止覆盖。'
}
Move-Item -Path $lxgwTemporaryOutput -Destination $lxgwOutput -Force

Write-Step '下载 Adobe 官方思源黑体简体中文可变 WOFF2 子集'
Download-VerifiedFile -Url $sourceHanWoff2Url -Destination $sourceHanOutput -MinimumBytes 5000000 -Description 'Source Han Sans CN Variable WOFF2'
Assert-Woff2 -Path $sourceHanOutput -Description '思源黑体简体中文可变字体'

Write-Step '下载两套字体的 OFL 授权文件'
Download-VerifiedFile -Url $lxgwLicenseUrl -Destination $lxgwLicense -MinimumBytes 1000 -Description 'LXGW WenKai Lite OFL license'
Download-VerifiedFile -Url $sourceHanLicenseUrl -Destination $sourceHanLicense -MinimumBytes 1000 -Description 'Source Han Sans OFL license'

$manifest = @"
# QD58 Zhuoyue 2026 - self-hosted fonts

Generated by scripts/download-fonts.ps1.

## LXGW WenKai Lite
- Version: $lxgwVersion (official release)
- Source: $lxgwTtfUrl
- Web font: assets/fonts/lxgw-wenkai-lite-regular.woff2
- Format: WOFF2 converted from the official Regular TTF with fonttools; all mapped Unicode characters retained.
- License: assets/fonts/OFL-LXGW-WenKai-Lite.txt (SIL Open Font License 1.1)

## Source Han Sans CN
- Release: Adobe Source Han Sans 2.005R release tree
- Pinned source commit: $sourceHanCommit
- Source: $sourceHanWoff2Url
- Web font: assets/fonts/source-han-sans-cn-variable.woff2
- Format: variable WOFF2, Simplified Chinese regional subset
- License: assets/fonts/OFL-Source-Han-Sans.txt (SIL Open Font License 1.1)

Both fonts are stored locally in this repository. The deployed site will not request Google Fonts or another remote font host.
"@
$manifestPath = Join-Path $fontDir 'FONT-SOURCES.md'
[System.IO.File]::WriteAllText($manifestPath, $manifest, [System.Text.UTF8Encoding]::new($false))

Write-Step '完成：字体文件已通过格式和大小校验'
Get-ChildItem $fontDir | Where-Object { $_.Name -match 'woff2|OFL-|FONT-SOURCES' } | Select-Object Name, @{Name='SizeMB';Expression={[math]::Round($_.Length / 1MB, 2)}} | Format-Table -AutoSize
Write-Host '下一步：检查 assets/fonts 文件后，将这些文件提交到 GitHub。暂时不要自行改 CSS；我会根据最终文件路径统一接入前端。' -ForegroundColor Green
