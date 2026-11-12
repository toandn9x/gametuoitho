# Built-in .NET XML parser: no npm dependency, DTD/entity expansion disabled.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try {
    $settings = New-Object System.Xml.XmlReaderSettings
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $settings.MaxCharactersInDocument = 8388608
    $reader = [System.Xml.XmlReader]::Create(
        (New-Object System.IO.StringReader([Console]::In.ReadToEnd())), $settings)
    $document = New-Object System.Xml.XmlDocument
    $document.XmlResolver = $null
    try { $document.Load($reader) } finally { $reader.Dispose() }
    $root = $document.DocumentElement
    if ($root.LocalName -ne 'ListBucketResult') { throw 'Invalid root' }
    function Field($Node, [string]$Name, [bool]$Required = $true) {
        $values = @($Node.ChildNodes | Where-Object { $_.LocalName -eq $Name })
        if ($values.Count -gt 1 -or ($Required -and $values.Count -ne 1)) { throw 'Invalid field' }
        if ($values.Count -eq 1) { return [string]$values[0].InnerText }
        return $null
    }
    $items = @($root.ChildNodes | Where-Object { $_.LocalName -eq 'Contents' } | ForEach-Object {
        @{ key = (Field $_ 'Key'); size = (Field $_ 'Size'); etag = (Field $_ 'ETag');
            modified = (Field $_ 'LastModified') }
    })
    $result = @{
        encoding = (Field $root 'EncodingType')
        truncated = (Field $root 'IsTruncated')
        next = (Field $root 'NextContinuationToken' $false)
        items = $items
    }
    [Console]::WriteLine((ConvertTo-Json -InputObject $result -Depth 6 -Compress))
} catch {
    [Console]::Error.WriteLine('Invalid S3 LIST XML.')
    exit 1
}
