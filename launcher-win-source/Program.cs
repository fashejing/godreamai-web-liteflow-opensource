using System.Windows.Forms;

namespace GoDreamAILauncher.Win;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new LauncherForm());
    }
}
