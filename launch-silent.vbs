' Winlator PC Edition - lancement silencieux intelligent
'  1. Verifie si le serveur tourne deja (anti double-instance)
'  2. Sinon, demarre node server.js cache et ATTEND qu'il reponde
'  3. Ouvre l'interface seulement quand le serveur est pret
'
' Utilisation :
'   wscript.exe launch-silent.vbs              -> serveur + interface
'   wscript.exe launch-silent.vbs /serveronly  -> serveur seul (demarrage auto)
Option Explicit
Dim shell, fso, base, serverOnly, i, arg
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)

serverOnly = False
For i = 0 To WScript.Arguments.Count - 1
  arg = LCase(WScript.Arguments(i))
  If arg = "/serveronly" Or arg = "-serveronly" Or arg = "--serveronly" Then serverOnly = True
Next

' --- 1) Serveur deja actif ? ---
If Not ServerUp() Then
  ' --- 2) Demarrage cache du serveur, puis attente active (max ~12 s) ---
  shell.Run "cmd /c cd /d """ & base & """ && node server.js", 0, False
  Dim ok, t
  ok = False
  For t = 1 To 24
    WScript.Sleep 500
    If ServerUp() Then
      ok = True
      Exit For
    End If
  Next
  If Not ok Then
    MsgBox "Winlator PC : le serveur n'a pas repondu apres 12 s." & vbCrLf & _
           "Verifiez que Node.js est installe, ou lancez start.bat pour voir l'erreur.", _
           vbExclamation, "Winlator PC Edition"
    WScript.Quit 1
  End If
End If

' --- 3) Interface (sauf mode serveur seul) ---
If Not serverOnly Then shell.Run "http://localhost:8799/", 1, False

Function ServerUp()
  On Error Resume Next
  Dim http
  Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
  http.Open "GET", "http://127.0.0.1:8799/api/state", False
  http.SetTimeouts 800, 800, 800, 800
  http.Send
  If Err.Number <> 0 Then
    ServerUp = False
  Else
    ServerUp = (http.Status = 200)
  End If
  Err.Clear
  On Error Goto 0
End Function
