using System.Windows.Forms;
internal static class Program {
  [STAThread] static void Main(string[] args) {
    ApplicationConfiguration.Initialize();
    using var form=new Form{Text="Voice Local owned close fixture",Width=380,Height=160};
    if(args.Contains("unsaved"))form.FormClosing+=(_,e)=>{e.Cancel=true;MessageBox.Show(form,"Unsaved fixture document. Close request was refused.","Save fixture document",MessageBoxButtons.OK);};
    Application.Run(form);
  }
}
