using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

// Host only our own note alongside Explorer's desktop icon view.
public static class DesktopLayer {
    delegate bool EnumWindow(IntPtr hwnd, IntPtr state);
    [DllImport("user32")] static extern bool EnumWindows(EnumWindow fn, IntPtr state);
    [DllImport("user32", CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
    [DllImport("user32")] static extern IntPtr GetShellWindow();
    [DllImport("user32")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32")] static extern IntPtr GetParent(IntPtr hwnd);
    [DllImport("user32")] static extern IntPtr GetDesktopWindow();
    [DllImport("user32", SetLastError=true)] static extern IntPtr SetParent(IntPtr hwnd, IntPtr parent);
    [DllImport("user32")] static extern int GetWindowLong(IntPtr hwnd, int index);
    [DllImport("user32")] static extern int SetWindowLong(IntPtr hwnd, int index, int value);
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] struct Point { public int x, y; }
    [DllImport("user32")] static extern bool GetWindowRect(IntPtr hwnd, out Rect r);
    [DllImport("user32")] static extern bool ScreenToClient(IntPtr hwnd, ref Point p);
    [DllImport("user32")] static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int w, int h, uint flags);
    [DllImport("user32")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    public static void Apply(long handle, uint process, bool dock) {
        IntPtr note = new IntPtr(handle), host = IntPtr.Zero;
        uint owner, shell;
        GetWindowThreadProcessId(note, out owner);
        if (owner != process) throw new InvalidOperationException("Invalid note window");
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        if (dock) {
            GetWindowThreadProcessId(GetShellWindow(), out shell);
            EnumWindows(delegate(IntPtr top, IntPtr unused) {
                uint pid;
                GetWindowThreadProcessId(top, out pid);
                if (pid != shell || FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) == IntPtr.Zero) return true;
                host = top;
                return false;
            }, IntPtr.Zero);
            if (host == IntPtr.Zero) throw new InvalidOperationException("Windows desktop is not ready");
        }
        if (GetParent(note) == host) return;
        Rect rect;
        if (!GetWindowRect(note, out rect)) throw new InvalidOperationException("Note has closed");
        int style = GetWindowLong(note, -16);
        const int child = 0x40000000, popup = unchecked((int)0x80000000);
        if (dock) SetWindowLong(note, -16, (style & ~popup) | child);
        SetParent(note, host);
        IntPtr actual = GetParent(note);
        if (actual != host && (dock || actual != GetDesktopWindow())) {
            int error = Marshal.GetLastWin32Error();
            SetWindowLong(note, -16, style);
            throw new Win32Exception(error);
        }
        if (!dock) SetWindowLong(note, -16, (style & ~child) | popup);
        Point pos = new Point { x = rect.left, y = rect.top };
        if (dock) ScreenToClient(host, ref pos);
        // SetParent can change DPI and frame metrics. Restore the physical rectangle,
        // including its size, before the new parent is painted.
        if (!SetWindowPos(note, IntPtr.Zero, pos.x, pos.y,
            rect.right - rect.left, rect.bottom - rect.top, 0x34))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }
}
