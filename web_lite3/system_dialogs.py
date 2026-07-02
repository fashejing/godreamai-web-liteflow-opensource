from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def _existing_directory(value: str | Path | None) -> Path:
    candidate = Path(value).expanduser() if value else Path.home()
    try:
        candidate = candidate.resolve()
    except Exception:
        candidate = candidate.expanduser()
    current = candidate
    while not current.exists() and current != current.parent:
        current = current.parent
    return current if current.exists() else Path.home()


def _pick_directory_macos(initial_dir: str | Path | None = None, *, prompt: str = "选择目录") -> str:
    start_dir = _existing_directory(initial_dir)
    script = """
on run argv
  set initialDir to POSIX file (item 1 of argv)
  set promptText to item 2 of argv
  try
    set chosenFolder to choose folder with prompt promptText default location initialDir
    return POSIX path of chosenFolder
  on error number -128
    return ""
  end try
end run
""".strip()
    try:
        completed = subprocess.run(
            ["osascript", "-e", script, str(start_dir), prompt],
            check=False,
            capture_output=True,
            text=True,
            timeout=90,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("目录选择超时，请重试") from exc
    except Exception as exc:
        raise RuntimeError("无法打开系统目录选择窗口") from exc
    if completed.returncode != 0:
        message = (completed.stderr or completed.stdout or "").strip() or "系统目录选择失败"
        raise RuntimeError(message)
    selected = (completed.stdout or "").strip()
    return str(Path(selected).expanduser().resolve()) if selected else ""


def _dialog_subprocess_kwargs() -> dict[str, object]:
    kwargs: dict[str, object] = {
        "check": False,
        "capture_output": True,
        "text": True,
        "timeout": 90,
    }
    if sys.platform == "win32":
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= getattr(subprocess, "STARTF_USESHOWWINDOW", 0)
        kwargs["startupinfo"] = startupinfo
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return kwargs


def _pick_directory_windows(initial_dir: str | Path | None = None, *, prompt: str = "选择目录") -> str:
    start_dir = _existing_directory(initial_dir)
    script = """
$InitialDir = $env:GODREAMAI_PICKER_INITIAL_DIR
$PromptText = $env:GODREAMAI_PICKER_PROMPT
try {
  Add-Type -AssemblyName System.Windows.Forms | Out-Null
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  try {
    $dialog.Description = $PromptText
    $dialog.ShowNewFolderButton = $true
    if ($dialog.PSObject.Properties.Name -contains 'UseDescriptionForTitle') {
      $dialog.UseDescriptionForTitle = $true
    }
    if ($InitialDir -and (Test-Path -LiteralPath $InitialDir -PathType Container)) {
      $dialog.SelectedPath = $InitialDir
    }
    $result = $dialog.ShowDialog()
    if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) {
      [Console]::Out.Write($dialog.SelectedPath)
    }
  } finally {
    $dialog.Dispose()
  }
} catch {
  [Console]::Error.Write($_.Exception.Message)
  exit 1
}
""".strip()
    env = dict(os.environ)
    env["GODREAMAI_PICKER_INITIAL_DIR"] = str(start_dir)
    env["GODREAMAI_PICKER_PROMPT"] = str(prompt)
    try:
        completed = subprocess.run(
            [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-STA",
                "-Command",
                script,
            ],
            env=env,
            **_dialog_subprocess_kwargs(),
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("目录选择超时，请重试") from exc
    except Exception as exc:
        raise RuntimeError("无法打开系统目录选择窗口") from exc
    if completed.returncode != 0:
        message = (completed.stderr or completed.stdout or "").strip() or "系统目录选择失败"
        raise RuntimeError(message)
    selected = (completed.stdout or "").strip()
    return str(Path(selected).expanduser().resolve()) if selected else ""


def _pick_directory_unsupported(initial_dir: str | Path | None = None, *, prompt: str = "选择目录") -> str:
    raise RuntimeError("当前环境不支持系统目录选择")


def pick_directory(initial_dir: str | Path | None = None, *, prompt: str = "选择目录") -> str:
    picker = {
        "darwin": _pick_directory_macos,
        "win32": _pick_directory_windows,
    }.get(sys.platform, _pick_directory_unsupported)
    return picker(initial_dir, prompt=prompt)