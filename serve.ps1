# เปิดโปรแกรม PCSK PHOTO ในเครื่องนี้ (ไม่ต้องติดตั้งอะไรเพิ่ม)
# วิธีใช้: powershell -ExecutionPolicy Bypass -File serve.ps1
# ถ้าพอร์ตที่กำหนดถูกใช้อยู่ จะลองพอร์ตถัดไปให้เอง แล้วเปิดเบราว์เซอร์ให้อัตโนมัติ
param([int]$Port = 8090, [switch]$NoBrowser)

$root = [IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
$types = @{
  '.html' = 'text/html; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.js' = 'application/javascript; charset=utf-8'; '.json' = 'application/json'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.svg' = 'image/svg+xml'; '.ico' = 'image/x-icon'; '.webp' = 'image/webp'
}

$listener = $null
foreach ($p in $Port..($Port + 20)) {
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add("http://localhost:$p/")
  try { $l.Start(); $listener = $l; $Port = $p; break } catch { $l.Close() }
}
if (-not $listener) {
  # ข้อความในหน้าต่างนี้ใช้ภาษาอังกฤษ เพราะบางเครื่องแสดงภาษาไทยใน PowerShell ไม่ได้
  Write-Host "Cannot start: ports $Port to $($Port + 20) are all in use." -ForegroundColor Red
  Read-Host 'Press Enter to close'
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host ''
Write-Host '  PCSK PHOTO is running.' -ForegroundColor Green
Write-Host "  Open in Chrome or Edge:  $url" -ForegroundColor Yellow
Write-Host '  Keep this window open while you work. Close it (or press Ctrl+C) when done.'
Write-Host ''

if (-not $NoBrowser) {
  # เปิดด้วย Chrome หรือ Edge ถ้ามี ไม่งั้นใช้เบราว์เซอร์หลักของเครื่อง
  $browsers = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
  )
  $exe = $browsers | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
  try { if ($exe) { Start-Process $exe $url } else { Start-Process $url } } catch { }
}

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
      if ($rel -eq '') { $rel = 'index.html' }
      $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if ($full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($full)
        $ext = [IO.Path]::GetExtension($full).ToLower()
        $res.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
        $res.Headers.Add('Cache-Control', 'no-cache')
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      } else {
        $res.StatusCode = 404
      }
    } catch {
      $res.StatusCode = 500
    } finally {
      $res.Close()
    }
  }
} finally {
  $listener.Stop()
}
