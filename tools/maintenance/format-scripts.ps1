param([switch]$Check, [string[]]$Path)
$ErrorActionPreference = 'Stop'
Import-Module PSScriptAnalyzer -MinimumVersion 1.25.0 -ErrorAction Stop
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$settings = Join-Path $PSScriptRoot 'powershell-format.psd1'
function Read-Script([string]$Text) {
    $tokens = $null
    $issues = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($Text, [ref]$tokens, [ref]$issues)
    if ($issues.Count) {
        throw ('PowerShell syntax error: ' + $issues[0].Message)
    }
    return @{ Ast = $ast
        Tokens    = $tokens
    }
}
function Get-StructuralSignature($Ast) {
    $nodes = $Ast.FindAll({ $true }, $true)
    $values = foreach ($node in $nodes) {
        $value = $null
        if ($node -is [System.Management.Automation.Language.ConstantExpressionAst]) {
            $value = $node.Value
        }
        elseif ($node -is [System.Management.Automation.Language.ExpandableStringExpressionAst]) {
            $value = $node.Value
        }
        elseif ($node -is [System.Management.Automation.Language.VariableExpressionAst]) {
            $value = $node.VariablePath.UserPath
        }
        elseif ($node -is [System.Management.Automation.Language.TypeConstraintAst]) {
            $value = $node.TypeName.FullName
        }
        elseif ($node -is [System.Management.Automation.Language.FunctionDefinitionAst]) {
            $value = $node.Name
        }
        @{ Type   = $node.GetType().FullName
            Value = $value
        }
    }
    return ConvertTo-Json -InputObject @($values) -Depth 6 -Compress
}
if (!$Path) {
    $Path = @(& git -C $root ls-files -- '*.ps1' '*.psd1')
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to enumerate tracked scripts'
    }
}
$changed = @()
foreach ($relative in $Path) {
    $file = if ([IO.Path]::IsPathRooted($relative)) {
        $relative
    }
    else {
        Join-Path $root $relative
    }
    $bytes = [IO.File]::ReadAllBytes($file)
    $bom = $bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191
    $text = [Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xFEFF)
    $before = Read-Script $text
    $newline = if ($text.Contains("`r`n")) {
        "`r`n"
    }
    else {
        "`n"
    }
    # Statement separators become line breaks, while for-loop header separators
    # and literal contents (including embedded C#/TypeScript) remain untouched.
    $loops = @($before.Ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.ForStatementAst] }, $true))
    $separators = @($before.Tokens | Where-Object {
            $token = $_
            $token.Kind -eq 'Semi' -and !@($loops | Where-Object {
                    $token.Extent.StartOffset -ge $_.Extent.StartOffset -and $token.Extent.EndOffset -le $_.Body.Extent.StartOffset
                }).Count
        } | Sort-Object { $_.Extent.StartOffset } -Descending)
    $next = $text
    foreach ($token in $separators) {
        $next = $next.Substring(0, $token.Extent.StartOffset) + $newline + $next.Substring($token.Extent.EndOffset)
    }
    $next = Invoke-Formatter -ScriptDefinition $next -Settings $settings
    # PSScriptAnalyzer can leave trailing spaces when expanding one-line blocks.
    # Remove them only outside string tokens so here-string payloads stay exact.
    $formatted = Read-Script $next
    $literals = @($formatted.Tokens | Where-Object {
            $_.Kind.ToString() -in @('StringLiteral', 'StringExpandable', 'HereStringLiteral', 'HereStringExpandable')
        })
    $trailing = @([regex]::Matches($next, '(?m)[ \t]+(?=\r?$)') | Sort-Object Index -Descending)
    foreach ($space in $trailing) {
        if (!@($literals | Where-Object {
                    $space.Index -ge $_.Extent.StartOffset -and $space.Index -lt $_.Extent.EndOffset
                }).Count) {
            $next = $next.Remove($space.Index, $space.Length)
        }
    }
    $next = $next.TrimEnd() + $newline
    $after = Read-Script $next
    if ((Get-StructuralSignature $before.Ast) -cne (Get-StructuralSignature $after.Ast)) {
        throw ('Formatter changed syntax structure or literal contents: ' + $relative)
    }
    if ($next -cne $text) {
        $changed += $relative
        if (!$Check) {
            [IO.File]::WriteAllText($file, $next, (New-Object Text.UTF8Encoding($bom)))
        }
    }
}
if ($Check -and $changed.Count) {
    $changed | ForEach-Object { Write-Output ('Needs formatting: ' + $_) }
    exit 1
}
Write-Output ('PowerShell formatting verified: ' + $Path.Count + ' scripts; changed: ' + $changed.Count)
