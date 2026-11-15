# Armor Lab - tiny local web server (Windows PowerShell 5.1+, no install needed)
# Serves the game folder on http://127.0.0.1:<port>/ and opens the browser.
# Only listens on 127.0.0.1, so nothing is exposed to the network.
param([int]$Port = 8765, [switch]$NoBrowser)

$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'
  '.json' = 'application/json'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'
  '.hdr' = 'application/octet-stream'; '.mp4' = 'video/mp4'; '.webm' = 'video/webm'; '.ico' = 'image/x-icon'; '.md' = 'text/plain; charset=utf-8'
}

$listener = $null
for ($p = $Port; $p -lt $Port + 20; $p++) {
  try {
    $l = New-Object System.Net.HttpListener
    $l.Prefixes.Add("http://127.0.0.1:$p/")
    $l.Start()
    $listener = $l; $Port = $p; break
  } catch { }
}
if (-not $listener) { Write-Host "Could not open a local port (8765-8784)."; Read-Host 'Press Enter to exit'; exit 1 }

$url = "http://127.0.0.1:$Port/play.html"
Write-Host ""
Write-Host "  Armor Lab is running at $url"
Write-Host "  Keep this window open while playing. Close it (or press Ctrl+C) to stop."
Write-Host ""
if (-not $NoBrowser) { Start-Process $url }

while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq '') { $rel = 'play.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $res.StatusCode = 404; $b = [Text.Encoding]::UTF8.GetBytes('404'); $res.OutputStream.Write($b, 0, $b.Length)
    } else {
      $bytes = [IO.File]::ReadAllBytes($full)
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $type = $mime[$ext]; if (-not $type) { $type = 'application/octet-stream' }
      $res.ContentType = $type
      $res.Headers.Add('Cache-Control', 'no-cache')
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch { try { $res.StatusCode = 500 } catch { } }
  finally { try { $res.OutputStream.Close() } catch { } }
}
