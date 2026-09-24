<#
  Opens .docx files in a hidden Microsoft Word, read-only and without repair, and writes what Word
  reports about each one as JSON: paragraphs (style, live list number, font, spacing), tables,
  sections (margins, header and footer text and fields), content controls, notes, comments,
  revisions, pictures, text boxes and tables of contents; and, for texts listed in -ProbeFile
  ({ "<file name>": ["text", …] }), the formatting Word applies to them. Optionally exports PDFs.
  Only the Word instance this script starts is closed; any Word already open is left alone.
  Run by scripts/word/check.ts (npm run check:word); Windows PowerShell 5.1.
#>
param(
  [Parameter(Mandatory = $true)][string]$ListFile,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [string]$PidFile = "",
  [string]$ProbeFile = "",
  [switch]$Pdf
)
$ErrorActionPreference = "Stop"

# Word's methods take by-reference arguments, which PowerShell cannot pass directly; named IDispatch calls can.
function Invoke-Word($target, [string]$method, [System.Collections.Specialized.OrderedDictionary]$named) {
  $names = [string[]]@($named.Keys)
  $values = [object[]]@($named.Values | ForEach-Object { if ($_ -is [psobject]) { $_.PSObject.BaseObject } else { $_ } })
  [System.__ComObject].InvokeMember($method, [System.Reflection.BindingFlags]::InvokeMethod, $null, $target, $values, $null, $null, $names)
}
$undefined = 9999999
function Flag($v) { if ($v -eq $undefined) { "mixed" } elseif ($v -ne 0) { $true } else { $false } }
function Clean([string]$s) { ($s -replace "[\r\a\x0b\x07]", " ").Trim() }

function Get-Format($range) {
  $f = $range.Font
  [ordered]@{ font = $f.Name; size = $f.Size; bold = Flag $f.Bold; italic = Flag $f.Italic; underline = Flag $f.Underline; color = $f.Color }
}

# Searches every story (body, headers, footers, notes, text boxes); reports the match and its first character.
function Find-Probe($doc, [string]$text) {
  foreach ($story in $doc.StoryRanges) {
    for ($r = $story; $null -ne $r; $r = $r.NextStoryRange) {
      $hit = $r.Duplicate
      if (-not (Invoke-Word $hit.Find "Execute" ([ordered]@{ FindText = $text; MatchCase = $true; MatchWildcards = $false; Forward = $true; Wrap = 0; Format = $false }))) { continue }
      $first = $hit.Duplicate
      $first.SetRange($hit.Start, $hit.Start + 1)
      return [ordered]@{ text = $text; found = $true; story = $r.StoryType; whole = Get-Format $hit; first = Get-Format $first }
    }
  }
  [ordered]@{ text = $text; found = $false }
}

function Get-Story($range) {
  [ordered]@{
    text     = Clean $range.Text
    fields   = @($range.Fields | ForEach-Object { $_.Type })
    images   = $range.InlineShapes.Count
    controls = @($range.ContentControls | ForEach-Object { [ordered]@{ title = $_.Title; placeholder = [bool]$_.ShowingPlaceholderText; mapped = [bool]$_.XMLMapping.IsMapped; text = Clean $_.Range.Text } })
  }
}

function Get-View($doc) {
  $paragraphs = foreach ($p in $doc.Paragraphs) {
    $r = $p.Range; $f = $r.Font; $lf = $r.ListFormat
    [ordered]@{
      text = Clean $r.Text; style = $p.Style.NameLocal; outline = $p.OutlineLevel
      list = $lf.ListString; listLevel = $lf.ListLevelNumber; listType = $lf.ListType
      align = $p.Alignment; left = $p.LeftIndent; first = $p.FirstLineIndent
      before = $p.SpaceBefore; after = $p.SpaceAfter; line = $p.LineSpacing
      font = $f.Name; size = $f.Size; bold = Flag $f.Bold; italic = Flag $f.Italic; underline = Flag $f.Underline
      inTable = [bool]$r.Information(12)
    }
  }
  $sections = foreach ($s in $doc.Sections) {
    $ps = $s.PageSetup
    [ordered]@{
      top = $ps.TopMargin; bottom = $ps.BottomMargin; left = $ps.LeftMargin; right = $ps.RightMargin
      width = $ps.PageWidth; height = $ps.PageHeight; orientation = $ps.Orientation
      header = Get-Story $s.Headers.Item(1).Range; footer = Get-Story $s.Footers.Item(1).Range
    }
  }
  $tables = foreach ($t in $doc.Tables) {
    [ordered]@{ rows = $t.Rows.Count; cols = $t.Columns.Count; borders = [bool]$t.Borders.Enable; cells = @($t.Range.Cells | ForEach-Object { Clean $_.Range.Text }) }
  }
  $shapes = foreach ($s in $doc.Shapes) {
    [ordered]@{ type = $s.Type; text = $(if ($s.TextFrame.HasText) { Clean $s.TextFrame.TextRange.Text } else { "" }) }
  }
  [ordered]@{
    pages = Invoke-Word $doc "ComputeStatistics" ([ordered]@{ Statistic = 2 })
    paragraphs = @($paragraphs); sections = @($sections); tables = @($tables); shapes = @($shapes)
    body = Get-Story $doc.Content
    footnotes = @($doc.Footnotes | ForEach-Object { Clean $_.Range.Text })
    endnotes = @($doc.Endnotes | ForEach-Object { Clean $_.Range.Text })
    comments = @($doc.Comments | ForEach-Object { [ordered]@{ author = $_.Author; text = Clean $_.Range.Text; scope = Clean $_.Scope.Text } })
    revisions = @($doc.Revisions | ForEach-Object { [ordered]@{ type = $_.Type; text = Clean $_.Range.Text } })
    tocs = $doc.TablesOfContents.Count
    fonts = @($paragraphs | ForEach-Object { $_.font } | Where-Object { $_ } | Sort-Object -Unique)
  }
}

$before = @(Get-Process WINWORD -ErrorAction SilentlyContinue | ForEach-Object Id)
$word = New-Object -ComObject Word.Application
$mine = @(Get-Process WINWORD | ForEach-Object Id | Where-Object { $before -notcontains $_ })
if ($PidFile) { Set-Content -Path $PidFile -Value ($mine -join ",") }
$results = @()
$probes = if ($ProbeFile) { Get-Content -Path $ProbeFile -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
try {
  $word.Visible = $false
  $word.DisplayAlerts = 0
  # Plain strings: Get-Content attaches provider objects that ConvertTo-Json would try to serialise.
  foreach ($path in [string[]](Get-Content -Path $ListFile -Encoding UTF8)) {
    if (-not $path.Trim()) { continue }
    $entry = [ordered]@{ file = $path; opened = $false; error = $null; view = $null }
    $clock = [Diagnostics.Stopwatch]::StartNew()
    try {
      $doc = Invoke-Word $word.Documents "Open" ([ordered]@{ FileName = [string]$path; ConfirmConversions = $false; ReadOnly = $true; AddToRecentFiles = $false; Visible = $false; OpenAndRepair = $false; NoEncodingDialog = $true })
      $entry.opened = $true
      try {
        $entry.view = Get-View $doc
        $texts = if ($probes) { $probes.PSObject.Properties[[System.IO.Path]::GetFileName($path)].Value } else { $null }
        $entry.view.probes = @($texts | Where-Object { $_ } | ForEach-Object { Find-Probe $doc ([string]$_) })
        if ($Pdf) { Invoke-Word $doc "ExportAsFixedFormat" ([ordered]@{ OutputFileName = [string]($path -replace "\.docx$", ".pdf"); ExportFormat = 17 }) | Out-Null }
      } finally { Invoke-Word $doc "Close" ([ordered]@{ SaveChanges = 0 }) | Out-Null }
    } catch {
      $entry.error = $(if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message })
    }
    $results += $entry
    Write-Output ("{0}: {1} in {2} ms" -f [System.IO.Path]::GetFileName($path), $(if ($entry.opened) { "read" } else { "NOT OPENED" }), $clock.ElapsedMilliseconds)
  }
  $report = [ordered]@{ word = [ordered]@{ version = [string]$word.Version; build = [string]$word.Build }; files = $results }
  [System.IO.File]::WriteAllText($OutFile, (ConvertTo-Json -InputObject $report -Depth 9), (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "wrote $OutFile"
} finally {
  # Quit only a Word this script started; never one the user already had open.
  if ($mine.Count -eq 1) { Invoke-Word $word "Quit" ([ordered]@{ SaveChanges = 0 }) | Out-Null }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
  Write-Output "Word closed"
}
