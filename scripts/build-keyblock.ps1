# Compiles scripts\keyblock.cs into build\keyblock.exe with the C# compiler that ships with Windows.
Set-Location (Split-Path $PSScriptRoot -Parent)
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /optimize+ /out:build\keyblock.exe /r:System.Windows.Forms.dll scripts\keyblock.cs
exit $LASTEXITCODE
