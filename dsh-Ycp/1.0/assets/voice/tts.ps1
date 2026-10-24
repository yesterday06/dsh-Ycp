param([string]$Payload)

# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 reads UTF-8 scripts as ANSI;
# a Chinese comment can decode into a backtick and swallow the next line.

$ErrorActionPreference = 'Stop'
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
  $OutputEncoding = New-Object System.Text.UTF8Encoding $false
} catch { }

function Out-Json($value) {
  Write-Output ($value | ConvertTo-Json -Compress -Depth 6)
}

try {
  $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Payload))
  $p = $json | ConvertFrom-Json
} catch {
  Out-Json @{ ok = $false; error = 'bad payload' }
  exit 1
}

Add-Type -AssemblyName System.Speech

try {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

  if ($p.action -eq 'list') {
    $voices = @()
    foreach ($item in $synth.GetInstalledVoices()) {
      $info = $item.VoiceInfo
      $voices += @{ name = $info.Name; culture = $info.Culture.Name; gender = [string]$info.Gender }
    }
    $synth.Dispose()
    Out-Json @{ ok = $true; voices = $voices }
    exit 0
  }

  if ($p.action -eq 'speak') {
    $name = [string]$p.voice
    if ($name) {
      $installed = @($synth.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name })
      if ($installed -contains $name) { $synth.SelectVoice($name) }
    }
    $synth.Volume = [int]$p.volume
    $synth.SetOutputToWaveFile([string]$p.out)

    $text = [string]$p.text
    if (-not $text) { throw 'empty text' }

    # Escape XML, then let SSML prosody carry rate and pitch.
    $text = $text.Replace('&', '&amp;')
    $text = $text.Replace('<', '&lt;')
    $text = $text.Replace('>', '&gt;')
    $text = $text.Replace('"', '&quot;')
    $text = $text.Replace("'", '&apos;')

    $rate = [int]$p.rate * 10
    $pitch = [int]$p.pitch
    $rateText = if ($rate -ge 0) { "+$rate%" } else { "$rate%" }
    $pitchText = if ($pitch -ge 0) { "+$pitch%" } else { "$pitch%" }
    $ssml = '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><prosody rate="' + $rateText + '" pitch="' + $pitchText + '">' + $text + '</prosody></speak>'

    $started = Get-Date
    try {
      $synth.SpeakSsml($ssml)
    } catch {
      # Some systems reject parts of SSML; fall back to plain text.
      $synth.Speak($text)
    }
    $synth.Dispose()
    $info = Get-Item ([string]$p.out)
    $ms = [int]((Get-Date) - $started).TotalMilliseconds
    Out-Json @{ ok = $true; bytes = $info.Length; ms = $ms }
    exit 0
  }

  $synth.Dispose()
  Out-Json @{ ok = $false; error = ('unknown action: ' + [string]$p.action) }
  exit 1
} catch {
  $msg = $_.Exception.Message
  $where = ''
  try { $where = $_.InvocationInfo.PositionMessage } catch { }
  Out-Json @{ ok = $false; error = $msg; where = $where }
  exit 1
}
