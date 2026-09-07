# =============================================================================
#  win-ocr.ps1  -  moteur OCR local (Windows Runtime), 100% hors ligne, gratuit
#  Utilise Windows.Media.Ocr (deja installe dans Windows) + Windows.Data.Pdf
#  pour transformer les pages PDF en images. Aucune installation requise.
#  Sortie : JSON sur stdout (lu par server.js).
#  Createur : Oualid Messaoudi - Editeur : Vitalink ATLS Education GmbH
#  vitalink-atls-education.de - HRB 38336 Dortmund - Licence MIT - v1.0.0
#  ASCII uniquement (PowerShell 5.1 lit ce fichier en ANSI).
# =============================================================================
param(
  [Parameter(Mandatory = $true)][ValidateSet('langs', 'image', 'pdf', 'resize')][string]$Mode,
  [string]$File,
  [string]$Lang = 'auto',
  [string]$Pages = '',
  [double]$Scale = 2.0,
  [int]$MaxEdge = 1568,
  [int]$Quality = 80,
  [string]$Out = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ---- passerelle async WinRT -> .NET ----------------------------------------
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$rtMethods = [System.WindowsRuntimeSystemExtensions].GetMethods()
$asTaskOp = ($rtMethods | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
$asTaskAct = ($rtMethods | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
  })[0]

function Await($op, $type) {
  $m = $asTaskOp.MakeGenericMethod($type)
  $t = $m.Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  $t.Result
}
function AwaitAction($act) {
  $t = $asTaskAct.Invoke($null, @($act))
  $t.Wait(-1) | Out-Null
}

[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime] | Out-Null
[Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime] | Out-Null

# ---- langues ----------------------------------------------------------------
function Get-Langs {
  [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { $_.LanguageTag }
}

$stopwords = @{
  'de' = @('der', 'die', 'und', 'von', 'mit', 'nicht', 'ist', 'den', 'dem', 'ein', 'eine', 'auf', 'fur', 'sie', 'wir', 'sich', 'oder', 'bei', 'rechnung', 'betrag');
  'fr' = @('le', 'la', 'les', 'des', 'une', 'pour', 'est', 'dans', 'vous', 'nous', 'que', 'qui', 'avec', 'sur', 'par', 'facture', 'montant');
  'en' = @('the', 'and', 'for', 'you', 'with', 'this', 'that', 'from', 'are', 'not', 'invoice', 'amount')
}

function Score-Text([string]$text, [string]$tag) {
  $key = $tag.Substring(0, 2).ToLower()
  if (-not $stopwords.ContainsKey($key)) { return 0 }
  $words = ($text.ToLower() -split '[^a-z0-9]+')
  $set = $stopwords[$key]
  ($words | Where-Object { $set -contains $_ }).Count
}

function Get-Engine([string]$tag) {
  [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($tag))
}

function Ocr-Bitmap($bitmap, [string]$want) {
  $available = @(Get-Langs)
  if ($available.Count -eq 0) { throw "aucune langue OCR installee dans Windows" }

  $tags = @()
  if ($want -eq 'auto') { $tags = $available }
  else {
    $tags = @($available | Where-Object { $_.ToLower().StartsWith($want.ToLower()) })
    if ($tags.Count -eq 0) { throw ("langue OCR '" + $want + "' non installee. Disponibles : " + ($available -join ', ')) }
  }

  $best = $null
  foreach ($tag in $tags) {
    $engine = Get-Engine $tag
    if ($null -eq $engine) { continue }
    $res = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $txt = $res.Text
    $score = Score-Text $txt $tag
    if ($null -eq $best -or $score -gt $best.score) {
      $best = [pscustomobject]@{ lang = $tag; text = $txt; score = $score }
    }
  }
  if ($null -eq $best) { throw "impossible de creer un moteur OCR" }
  $best
}

function Bitmap-FromFile([string]$path) {
  $f = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
  $stream = Await ($f.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
}

function Parse-Pages([string]$spec, [int]$count) {
  if ([string]::IsNullOrWhiteSpace($spec)) { return 1..$count }
  $list = New-Object System.Collections.Generic.List[int]
  foreach ($part in $spec -split ',') {
    $p = $part.Trim()
    if ($p -match '^(\d+)\s*-\s*(\d+)$') {
      $a = [int]$matches[1]; $b = [int]$matches[2]
      for ($i = $a; $i -le $b; $i++) { if ($i -ge 1 -and $i -le $count) { $list.Add($i) | Out-Null } }
    }
    elseif ($p -match '^\d+$') {
      $i = [int]$p
      if ($i -ge 1 -and $i -le $count) { $list.Add($i) | Out-Null }
    }
  }
  if ($list.Count -eq 0) { return 1..$count }
  $list | Select-Object -Unique
}

# ---- modes ------------------------------------------------------------------
switch ($Mode) {

  'langs' {
    $infos = [pscustomobject]@{ ok = $true; langues = @(Get-Langs) }
    $infos | ConvertTo-Json -Compress -Depth 4
  }

  'image' {
    if (-not (Test-Path -LiteralPath $File)) { throw ("fichier introuvable : " + $File) }
    $full = (Resolve-Path -LiteralPath $File).Path
    $bmp = Bitmap-FromFile $full
    $r = Ocr-Bitmap $bmp $Lang
    [pscustomobject]@{
      ok      = $true
      fichier = $full
      largeur = $bmp.PixelWidth
      hauteur = $bmp.PixelHeight
      langue  = $r.lang
      texte   = $r.text
    } | ConvertTo-Json -Compress -Depth 4
  }

  'pdf' {
    if (-not (Test-Path -LiteralPath $File)) { throw ("fichier introuvable : " + $File) }
    $full = (Resolve-Path -LiteralPath $File).Path
    $f = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($full)) ([Windows.Storage.StorageFile])
    $doc = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($f)) ([Windows.Data.Pdf.PdfDocument])
    $wanted = Parse-Pages $Pages $doc.PageCount

    $tmpDir = Join-Path $env:TEMP ("ocrmcp_" + [guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $tmpDir | Out-Null
    $lues = @()
    try {
      foreach ($n in $wanted) {
        $page = $doc.GetPage($n - 1)
        $png = Join-Path $tmpDir ("p" + $n + ".png")
        New-Item -ItemType File -Path $png | Out-Null
        $outFile = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($png)) ([Windows.Storage.StorageFile])
        $stream = Await ($outFile.OpenAsync([Windows.Storage.FileAccessMode]::ReadWrite)) ([Windows.Storage.Streams.IRandomAccessStream])
        $opt = New-Object Windows.Data.Pdf.PdfPageRenderOptions
        $opt.DestinationWidth = [uint32]([math]::Round($page.Size.Width * $Scale))
        AwaitAction ($page.RenderToStreamAsync($stream, $opt))
        $stream.Dispose()
        if ($page -is [System.IDisposable]) { $page.Dispose() }

        $bmp = Bitmap-FromFile $png
        $r = Ocr-Bitmap $bmp $Lang
        $lues += [pscustomobject]@{ page = $n; langue = $r.lang; texte = $r.text }
        Remove-Item -LiteralPath $png -Force
      }
    }
    finally {
      if (Test-Path -LiteralPath $tmpDir) { Remove-Item -LiteralPath $tmpDir -Recurse -Force }
    }

    [pscustomobject]@{
      ok           = $true
      fichier      = $full
      total_pages  = $doc.PageCount
      pages_lues   = @($wanted)
      pages        = $lues
    } | ConvertTo-Json -Compress -Depth 5
  }

  'resize' {
    if (-not (Test-Path -LiteralPath $File)) { throw ("fichier introuvable : " + $File) }
    Add-Type -AssemblyName System.Drawing
    $full = (Resolve-Path -LiteralPath $File).Path
    $img = [System.Drawing.Image]::FromFile($full)
    try {
      $w = $img.Width; $h = $img.Height
      $edge = [Math]::Max($w, $h)
      $ratio = if ($edge -gt $MaxEdge) { $MaxEdge / $edge } else { 1.0 }
      $nw = [int][Math]::Round($w * $ratio); $nh = [int][Math]::Round($h * $ratio)

      if ([string]::IsNullOrWhiteSpace($Out)) {
        $Out = Join-Path ([System.IO.Path]::GetDirectoryName($full)) ([System.IO.Path]::GetFileNameWithoutExtension($full) + "_ia.jpg")
      }
      $bmp = New-Object System.Drawing.Bitmap $nw, $nh
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.DrawImage($img, 0, 0, $nw, $nh)
      $g.Dispose()

      $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
      $params = New-Object System.Drawing.Imaging.EncoderParameters 1
      $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([int]$Quality)
      $bmp.Save($Out, $codec, $params)
      $bmp.Dispose()

      [pscustomobject]@{
        ok             = $true
        source         = $full
        sortie         = $Out
        largeur_avant  = $w
        hauteur_avant  = $h
        largeur_apres  = $nw
        hauteur_apres  = $nh
        octets_avant   = (Get-Item -LiteralPath $full).Length
        octets_apres   = (Get-Item -LiteralPath $Out).Length
      } | ConvertTo-Json -Compress -Depth 4
    }
    finally { $img.Dispose() }
  }
}
