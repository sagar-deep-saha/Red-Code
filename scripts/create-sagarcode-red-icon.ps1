#requires -Version 5.1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$assetRoot = Join-Path $repoRoot 'resources\win32'

function New-SagarCodeRedBitmap([int]$Size) {
	$bitmap = [System.Drawing.Bitmap]::new($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
	$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
	$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
	$graphics.Clear([System.Drawing.Color]::Transparent)

	$bounds = [System.Drawing.Rectangle]::new(1, 1, $Size - 2, $Size - 2)
	$diameter = [Math]::Max(4, [int][Math]::Round($Size * 0.26))
	$path = [System.Drawing.Drawing2D.GraphicsPath]::new()
	$path.AddArc($bounds.X, $bounds.Y, $diameter, $diameter, 180, 90)
	$path.AddArc($bounds.Right - $diameter, $bounds.Y, $diameter, $diameter, 270, 90)
	$path.AddArc($bounds.Right - $diameter, $bounds.Bottom - $diameter, $diameter, $diameter, 0, 90)
	$path.AddArc($bounds.X, $bounds.Bottom - $diameter, $diameter, $diameter, 90, 90)
	$path.CloseFigure()

	$gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
		$bounds,
		[System.Drawing.Color]::FromArgb(255, 239, 68, 68),
		[System.Drawing.Color]::FromArgb(255, 127, 0, 18),
		45.0
	)
	$graphics.FillPath($gradient, $path)

	$mark = [System.Drawing.Drawing2D.GraphicsPath]::new()
	$mark.StartFigure()
	$mark.AddBezier(
		[float]($Size * 0.72), [float]($Size * 0.29),
		[float]($Size * 0.39), [float]($Size * 0.08),
		[float]($Size * 0.19), [float]($Size * 0.35),
		[float]($Size * 0.45), [float]($Size * 0.48)
	)
	$mark.AddBezier(
		[float]($Size * 0.45), [float]($Size * 0.48),
		[float]($Size * 0.84), [float]($Size * 0.58),
		[float]($Size * 0.68), [float]($Size * 0.93),
		[float]($Size * 0.28), [float]($Size * 0.73)
	)
	$markPen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, [float]($Size * 0.09))
	$markPen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
	$markPen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
	$markPen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
	$graphics.DrawPath($markPen, $mark)

	$markPen.Dispose()
	$mark.Dispose()
	$gradient.Dispose()
	$path.Dispose()
	$graphics.Dispose()
	return $bitmap
}

$tile150 = New-SagarCodeRedBitmap 150
$tile150.Save((Join-Path $assetRoot 'code_150x150.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$tile150.Dispose()

$tile70 = New-SagarCodeRedBitmap 70
$tile70.Save((Join-Path $assetRoot 'code_70x70.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$tile70.Dispose()

$icon = New-SagarCodeRedBitmap 256
$pngStream = [System.IO.MemoryStream]::new()
$icon.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)
$pngBytes = $pngStream.ToArray()
$icon.Dispose()
$pngStream.Dispose()

$iconPath = Join-Path $assetRoot 'code.ico'
$stream = [System.IO.File]::Open($iconPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
$writer = [System.IO.BinaryWriter]::new($stream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([byte]0) # 256 pixels
$writer.Write([byte]0) # 256 pixels
$writer.Write([byte]0)
$writer.Write([byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$pngBytes.Length)
$writer.Write([UInt32]22)
$writer.Write($pngBytes)
$writer.Dispose()
$stream.Dispose()

Write-Host "Generated SagarCode Red Windows icon assets in $assetRoot"