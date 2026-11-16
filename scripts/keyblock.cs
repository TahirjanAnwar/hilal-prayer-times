// Blocks the keyboard while the child lock screen is showing.
// Usage: keyblock.exe <parent process id>   (stops by itself when that process ends)
//        keyblock.exe --test                (installs the hook, blocks nothing, exits after 1.5 s)
// Build: npm run keyblock   (output: build/keyblock.exe)
// Windows never lets a program block Ctrl+Alt+Del.
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;

static class KeyBlock
{
    delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr SetWindowsHookEx(int idHook, HookProc callback, IntPtr hMod, uint threadId);
    [DllImport("user32.dll")]
    static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")]
    static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr GetModuleHandle(string name);

    const int WH_KEYBOARD_LL = 13;
    const int WM_KEYUP = 0x101, WM_SYSKEYUP = 0x105;

    static readonly HookProc proc = Hook; // kept in a field so it is not garbage-collected
    static bool swallow = true;

    static IntPtr Hook(int code, IntPtr wParam, IntPtr lParam)
    {
        int msg = wParam.ToInt32();
        // Key releases pass through so no key is left "stuck down" from before the lock.
        if (code >= 0 && swallow && msg != WM_KEYUP && msg != WM_SYSKEYUP) return (IntPtr)1;
        return CallNextHookEx(IntPtr.Zero, code, wParam, lParam);
    }

    [STAThread]
    static int Main(string[] args)
    {
        bool test = args.Length > 0 && args[0] == "--test";
        int parentId = 0;
        if (!test && (args.Length == 0 || !int.TryParse(args[0], out parentId))) return 1;
        swallow = !test;

        IntPtr hook = SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(null), 0);
        if (hook == IntPtr.Zero) return 2;

        DateTime started = DateTime.UtcNow;
        Timer timer = new Timer();
        timer.Interval = 500;
        timer.Tick += delegate
        {
            bool stop = test ? (DateTime.UtcNow - started).TotalMilliseconds > 1500 : !Alive(parentId);
            if (stop) Application.ExitThread();
        };
        timer.Start();
        Application.Run();
        UnhookWindowsHookEx(hook);
        return 0;
    }

    static bool Alive(int id)
    {
        try { return !Process.GetProcessById(id).HasExited; }
        catch { return false; }
    }
}
