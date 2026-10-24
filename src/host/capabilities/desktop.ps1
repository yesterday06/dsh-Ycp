param([string]$Payload)

$ErrorActionPreference = 'Stop'
# Keep stdout UTF-8 so Node can read Chinese window titles
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
  $OutputEncoding = New-Object System.Text.UTF8Encoding $false
} catch { }

function Fail($message) {
  $out = @{ ok = $false; error = [string]$message }
  Write-Output ($out | ConvertTo-Json -Compress)
  exit 1
}

try {
  $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Payload))
  $p = $json | ConvertFrom-Json
} catch {
  Fail "bad payload"
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class YcpWin {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
"@

function Get-ForegroundTitle {
  $h = [YcpWin]::GetForegroundWindow()
  $len = [YcpWin]::GetWindowTextLength($h)
  $sb = New-Object System.Text.StringBuilder ([Math]::Max(16, $len + 1))
  [void][YcpWin]::GetWindowText($h, $sb, $sb.Capacity)
  return $sb.ToString()
}

function Send-Mouse($down, $x, $y) {
  # 0x0002 left down, 0x0004 left up
  $flag = if ($down) { 0x0002 } else { 0x0004 }
  [YcpWin]::mouse_event([uint32]$flag, 0, 0, 0, [UIntPtr]::Zero)
}

function Focus-Process($pidValue) {
  $proc = Get-Process -Id ([int]$pidValue) -ErrorAction SilentlyContinue
  if (-not $proc) { throw "process not found" }
  if (-not $proc.MainWindowHandle -or $proc.MainWindowHandle -eq 0) {
    Start-Sleep -Milliseconds 600
    $proc.Refresh()
  }
  if (-not $proc.MainWindowHandle -or $proc.MainWindowHandle -eq 0) { throw "process has no window" }
  $hwnd = $proc.MainWindowHandle

  # A background process often cannot call SetForegroundWindow directly.
  # Try in order: restore, set foreground, COM AppActivate, Alt unlock, set again.
  [void][YcpWin]::ShowWindow($hwnd, 9)
  [void][YcpWin]::SetForegroundWindow($hwnd)
  Start-Sleep -Milliseconds 300
  if ([YcpWin]::GetForegroundWindow() -ne $hwnd) {
    try {
      $shell = New-Object -ComObject WScript.Shell
      [void]$shell.AppActivate([int]$pidValue)
    } catch { }
    Start-Sleep -Milliseconds 350
  }
  if ([YcpWin]::GetForegroundWindow() -ne $hwnd) {
    [System.Windows.Forms.SendKeys]::SendWait('%')
    Start-Sleep -Milliseconds 150
    [void][YcpWin]::SetForegroundWindow($hwnd)
    Start-Sleep -Milliseconds 300
  }
  if ([YcpWin]::GetForegroundWindow() -ne $hwnd) { throw ("cannot bring window to front: " + $proc.MainWindowTitle) }
  return $hwnd
}

$action = [string]$p.action
$result = @{ ok = $true; action = $action }

switch ($action) {
  'info' {
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $windows = @()
    foreach ($proc in Get-Process | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.Length -gt 0 }) {
      $windows += @{ id = $proc.Id; title = $proc.MainWindowTitle; process = $proc.ProcessName }
      if ($windows.Count -ge 40) { break }
    }
    $result.screen = @{ width = $screen.Width; height = $screen.Height }
    $result.foreground = Get-ForegroundTitle
    $result.windows = $windows
  }
  'screenshot' {
    $bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $graphics.Dispose()
    $bitmap.Save([string]$p.path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bitmap.Dispose()
    $info = Get-Item ([string]$p.path)
    $result.file = [string]$p.path
    $result.bytes = $info.Length
    $result.width = $bounds.Width
    $result.height = $bounds.Height
  }
  'move' {
    [void][YcpWin]::SetCursorPos([int]$p.x, [int]$p.y)
    $result.x = [int]$p.x
    $result.y = [int]$p.y
  }
  'click' {
    [void][YcpWin]::SetCursorPos([int]$p.x, [int]$p.y)
    Start-Sleep -Milliseconds 120
    Send-Mouse $true $p.x $p.y
    Start-Sleep -Milliseconds 60
    Send-Mouse $false $p.x $p.y
    $result.x = [int]$p.x
    $result.y = [int]$p.y
  }
  'drag' {
    [void][YcpWin]::SetCursorPos([int]$p.fromX, [int]$p.fromY)
    Start-Sleep -Milliseconds 120
    Send-Mouse $true $p.fromX $p.fromY
    $steps = 12
    for ($i = 1; $i -le $steps; $i++) {
      $x = [int]$p.fromX + [int](($p.toX - $p.fromX) * $i / $steps)
      $y = [int]$p.fromY + [int](($p.toY - $p.fromY) * $i / $steps)
      [void][YcpWin]::SetCursorPos($x, $y)
      Start-Sleep -Milliseconds 25
    }
    Send-Mouse $false $p.toX $p.toY
    $result.from = @{ x = [int]$p.fromX; y = [int]$p.fromY }
    $result.to = @{ x = [int]$p.toX; y = [int]$p.toY }
  }
  'focus' {
    if ($p.pid) { [void](Focus-Process $p.pid) }
    elseif ($p.title) {
      $target = Get-Process | Where-Object { $_.MainWindowTitle -like ("*" + $p.title + "*") } | Select-Object -First 1
      if (-not $target) { throw "no window matching title" }
      [void](Focus-Process $target.Id)
    } else { throw "focus needs pid or title" }
    $result.foreground = Get-ForegroundTitle
  }
  'type' {
    if ($p.pid) {
      [void](Focus-Process $p.pid)
      $title = Get-ForegroundTitle
      if ($p.expectTitle -and ($title -notlike ("*" + $p.expectTitle + "*"))) {
        throw ("focus landed on wrong window: " + $title)
      }
    }
    Set-Clipboard -Value ([string]$p.text)
    Start-Sleep -Milliseconds 120
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 200
    $result.foreground = Get-ForegroundTitle
    $result.chars = ([string]$p.text).Length
  }
  'key' {
    if ($p.pid) {
      [void](Focus-Process $p.pid)
      $title = Get-ForegroundTitle
      if ($p.expectTitle -and ($title -notlike ("*" + $p.expectTitle + "*"))) {
        throw ("focus landed on wrong window: " + $title)
      }
    }
    [System.Windows.Forms.SendKeys]::SendWait([string]$p.keys)
    Start-Sleep -Milliseconds 150
    $result.keys = [string]$p.keys
    $result.foreground = Get-ForegroundTitle
  }
  'clipboard' {
    $result.text = (Get-Clipboard -Raw -ErrorAction SilentlyContinue)
  }
  'launch' {
    $proc = Start-Process -FilePath ([string]$p.path) -PassThru
    # Windows 11 Notepad is a packaged app: the launcher may exit at once and the real
    # window belongs to another process with the same name. Wait, then look for a new
    # titled window; fall back to the launcher process if none appears.
    $deadline = (Get-Date).AddSeconds(8)
    $found = $null
    while ((Get-Date) -lt $deadline) {
      Start-Sleep -Milliseconds 300
      try { $proc.Refresh() } catch { }
      if ($proc.MainWindowHandle -and $proc.MainWindowHandle -ne 0 -and $proc.MainWindowTitle) { $found = $proc; break }
      $name = [System.IO.Path]::GetFileNameWithoutExtension([string]$p.path)
      $candidate = Get-Process -Name $name -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
        Select-Object -First 1
      if ($candidate) { $found = $candidate; break }
    }
    if (-not $found) { $found = $proc }
    $result.launcherPid = $proc.Id
    $result.pid = $found.Id
    $result.process = $found.ProcessName
    $result.title = $found.MainWindowTitle
    $result.windowFound = [bool]($found.MainWindowHandle -and $found.MainWindowHandle -ne 0)
  }
  default { Fail ("unknown action: " + $action) }
}

Write-Output ($result | ConvertTo-Json -Compress -Depth 5)
