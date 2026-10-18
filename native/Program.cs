using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Speech.Synthesis;
using System.Text.Json;
using NAudio.Wave;
using NAudio.CoreAudioApi;

static class Program {
  static readonly object outputLock=new();
  static readonly Control dispatch=new();
  static WaveInEvent? recorder;
  static WaveFileWriter? writer;
  static readonly object audioLock=new();
  static readonly SpeechSynthesizer speaker=new();
  static WaveOutEvent? playback;
  static readonly object playbackLock=new();
  static readonly HookProc hookProc=OnKey;
  static IntPtr hook;
  static string dictation="Alt+Space",agent="Control+Alt+Space",active="";
  static string activeChord="";
  static int activeKey;
  static readonly HashSet<int> pressedKeys=new();
  static bool hold=true;
  static long target;
  static DateTime recordingSince;
  static string audioPath="";
  [STAThread] static void Main(){
    Console.InputEncoding=new System.Text.UTF8Encoding(false);
    Console.OutputEncoding=new System.Text.UTF8Encoding(false);
    Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
    dispatch.CreateControl();
    hook=SetWindowsHookEx(13,hookProc,GetModuleHandle(null),0);
    Emit(new {type="ready",hook=hook!=IntPtr.Zero,codePage=GetACP()});
    Task.Run(()=>{string? line;while((line=Console.ReadLine())!=null){try{var data=JsonDocument.Parse(line).RootElement.Clone();dispatch.BeginInvoke(()=>Handle(data));}catch(Exception e){Emit(new{type="error",error=e.Message});}}dispatch.BeginInvoke(()=>Application.Exit());});
    Application.Run();
    if(hook!=IntPtr.Zero)UnhookWindowsHookEx(hook);
    recorder?.Dispose();writer?.Dispose();StopAudio();speaker.Dispose();
  }
  static void Emit(object data){lock(outputLock){Console.WriteLine(JsonSerializer.Serialize(data));Console.Out.Flush();}}
  static string Text(JsonElement e,string k,string fallback="")=>e.TryGetProperty(k,out var v)?v.ToString():fallback;
  static int Number(JsonElement e,string k,int fallback=0)=>e.TryGetProperty(k,out var v)&&v.TryGetInt32(out int n)?n:fallback;
  static void Handle(JsonElement e){
    string id=Text(e,"id"),op=Text(e,"op");
    try {
      object? result=null;
      switch(op){
        case "ping":result=new{ok=true,text=Text(e,"text")};break;
        case "configure":dictation=Text(e,"dictation","Alt+Space");agent=Text(e,"agent","Control+Alt+Space");hold=Text(e,"trigger","hold")=="hold";break;
        case "devices":result=Enumerable.Range(0,WaveInEvent.DeviceCount).Select(i=>new{id=i,name=WaveInEvent.GetCapabilities(i).ProductName}).ToArray();break;
        case "voices":result=speaker.GetInstalledVoices().Select(v=>new{id=v.VoiceInfo.Name,name=v.VoiceInfo.Name,language=v.VoiceInfo.Culture.Name}).ToArray();break;
        case "foreground":result=new{handle=GetForegroundWindow().ToInt64(),title=WindowTitle(GetForegroundWindow())};break;
        case "listRunningApps":result=RunningApps();break;
        case "closeApp":
          int closePid=Number(e,"pid");string closeStarted=Text(e,"startTime");
          _=Task.Run(()=>{try{Emit(new{type="response",id,result=CloseApp(closePid,closeStarted)});}catch(Exception error){Emit(new{type="response",id,error=error.Message});}});
          return;
        case "recordStart":
          if(recorder!=null)throw new Exception("Recording already active");
          audioPath=Path.GetFullPath(Text(e,"path"));Directory.CreateDirectory(Path.GetDirectoryName(audioPath)!);
          var capture=new WaveInEvent{DeviceNumber=Number(e,"deviceId",-1),WaveFormat=new WaveFormat(16000,16,1),BufferMilliseconds=60};
          WaveFileWriter? captureWriter=null;string capturePath=audioPath;DateTime started=DateTime.UtcNow;bool startedSuccessfully=false;
          try{
            captureWriter=new WaveFileWriter(capturePath,capture.WaveFormat);recorder=capture;writer=captureWriter;recordingSince=started;
            capture.DataAvailable+=(_,args)=>{lock(audioLock){if(captureWriter==null)return;captureWriter.Write(args.Buffer,0,args.BytesRecorded);}double sum=0;for(int i=0;i<args.BytesRecorded-1;i+=2){double x=BitConverter.ToInt16(args.Buffer,i)/32768.0;sum+=x*x;}Emit(new{type="level",value=Math.Sqrt(sum/Math.Max(1,args.BytesRecorded/2))});};
            capture.RecordingStopped+=(_,args)=>{lock(audioLock){captureWriter?.Dispose();captureWriter=null;if(ReferenceEquals(recorder,capture)){recorder=null;writer=null;}}capture.Dispose();if(startedSuccessfully)Emit(new{type="recordingStopped",path=capturePath,duration=(DateTime.UtcNow-started).TotalSeconds,error=args.Exception?.Message});};
            capture.StartRecording();startedSuccessfully=true;
          }catch{lock(audioLock){captureWriter?.Dispose();captureWriter=null;recorder=null;writer=null;}capture.Dispose();try{File.Delete(capturePath);}catch{}throw;}
          break;
        case "recordStop":recorder?.StopRecording();break;
        case "paste":
          long hwnd=long.TryParse(Text(e,"target"),out long h)?h:target;
          string text=Text(e,"text"),old=Clipboard.ContainsText()?Clipboard.GetText():"";
          if(hwnd!=0){SetForegroundWindow(new IntPtr(hwnd));Thread.Sleep(140);if(GetForegroundWindow().ToInt64()!=hwnd)throw new Exception("Cannot focus target window. Select the field and paste manually.");}
          Clipboard.SetText(text);KeyChord(0x11,0x56);
          var timer=new System.Windows.Forms.Timer{Interval=1800};timer.Tick+=(_,__)=>{timer.Stop();timer.Dispose();try{if(Clipboard.ContainsText()&&Clipboard.GetText()==text){if(old.Length>0)Clipboard.SetText(old);else Clipboard.Clear();}}catch{}};timer.Start();
          result=new{ok=true};break;
        case "selection":
          string previous=Clipboard.ContainsText()?Clipboard.GetText():"";Clipboard.Clear();KeyChord(0x11,0x43);Thread.Sleep(180);result=Clipboard.ContainsText()?Clipboard.GetText():"";if(previous.Length>0)Clipboard.SetText(previous);else Clipboard.Clear();break;
        case "volume":using(var devices=new MMDeviceEnumerator()){var device=devices.GetDefaultAudioEndpoint(DataFlow.Render,Role.Multimedia);device.AudioEndpointVolume.MasterVolumeLevelScalar=Math.Clamp(Number(e,"value",50)/100f,0,1);result=Math.Round(device.AudioEndpointVolume.MasterVolumeLevelScalar*100);}break;
        case "getVolume":using(var devices=new MMDeviceEnumerator()){var device=devices.GetDefaultAudioEndpoint(DataFlow.Render,Role.Multimedia);result=Math.Round(device.AudioEndpointVolume.MasterVolumeLevelScalar*100);}break;
        case "media":ushort key=Text(e,"action") switch{"next"=>0xB0,"previous"=>0xB1,"stop"=>0xB2,_=>0xB3};Press(key);break;
        case "speak":StopAudio();speaker.SpeakAsyncCancelAll();string voice=Text(e,"voice");if(voice.Length>0)speaker.SelectVoice(voice);speaker.SpeakAsync(Text(e,"text"));break;
        case "playAudio":speaker.SpeakAsyncCancelAll();PlayAudio(Text(e,"path"),Text(e,"deleteAfter")=="True"||Text(e,"deleteAfter")=="true");result=new{started=true};break;
        case "stopAudio":StopAudio();break;
        case "stopSpeak":speaker.SpeakAsyncCancelAll();StopAudio();break;
        case "sound":bool soundStart=Text(e,"phase")=="start";PlayTone(soundStart?660:440);break;
        case "quit":Application.Exit();break;
        default:throw new Exception("Unsupported native operation");
      }
      Emit(new{type="response",id,result});
    } catch(Exception error){Emit(new{type="response",id,error=error.Message});}
  }
  static bool Matches(string chord,int vk){var pieces=chord.Split('+');string last=pieces[^1];int code=last.ToLowerInvariant() switch{"space"=>32,"enter"=>13,"f8"=>119,"f9"=>120,"f10"=>121,_=>last.Length==1?char.ToUpperInvariant(last[0]):-1};if(vk!=code)return false;bool ctrl=(GetAsyncKeyState(0x11)&0x8000)!=0,alt=(GetAsyncKeyState(0x12)&0x8000)!=0,shift=(GetAsyncKeyState(0x10)&0x8000)!=0;return ctrl==pieces.Any(p=>p is "Control" or "Ctrl" or "CommandOrControl")&&alt==pieces.Contains("Alt")&&shift==pieces.Contains("Shift");}
  static IntPtr OnKey(int n,IntPtr w,IntPtr l){if(n>=0){int vk=Marshal.ReadInt32(l);int flags=Marshal.ReadInt32(l,8);if((flags&16)!=0)return CallNextHookEx(hook,n,w,l);bool down=w.ToInt64() is 0x100 or 0x104,up=w.ToInt64() is 0x101 or 0x105;bool repeat=down&&!pressedKeys.Add(vk);if(up)pressedKeys.Remove(vk);
      if(down&&!repeat&&active.Length==0){string mode=Matches(agent,vk)?"agent":Matches(dictation,vk)?"dictation":"";if(mode.Length>0){active=mode;activeKey=vk;activeChord=mode=="agent"?agent:dictation;target=GetForegroundWindow().ToInt64();Emit(new{type="shortcut",phase=hold?"start":"toggle",mode,target});return new IntPtr(1);}}
      if(active.Length>0){bool baseKey=vk==activeKey;bool modifierReleased=up&&((vk is 0x11 or 0xA2 or 0xA3)&&(activeChord.Contains("Control")||activeChord.Contains("Ctrl"))||(vk is 0x12 or 0xA4 or 0xA5)&&activeChord.Contains("Alt")||(vk is 0x10 or 0xA0 or 0xA1)&&activeChord.Contains("Shift"));if(up&&baseKey||modifierReleased){string mode=active;active="";activeChord="";if(hold)Emit(new{type="shortcut",phase="stop",mode,target});}if(baseKey)return new IntPtr(1);}
    }return CallNextHookEx(hook,n,w,l);}
  static string WindowTitle(IntPtr hwnd){var s=new System.Text.StringBuilder(512);GetWindowText(hwnd,s,s.Capacity);return s.ToString();}
  sealed record RunningApp(int pid,string startTime,string name,string processName,string title);
  static readonly HashSet<string> protectedProcesses=new(StringComparer.OrdinalIgnoreCase){"VoiceNative","Voice Local","electron","explorer","System","Idle","Registry","smss","csrss","wininit","services","lsass","winlogon","svchost","dwm","sihost","taskhostw","fontdrvhost","audiodg","conhost","dllhost","RuntimeBroker","ApplicationFrameHost","ShellExperienceHost","StartMenuExperienceHost","SearchHost","SearchApp","TextInputHost","LockApp","SecurityHealthSystray","Taskmgr","WindowsTerminal","OpenConsole","cmd","powershell","pwsh"};
  static readonly HashSet<string> windowsInteractiveProcesses=new(StringComparer.OrdinalIgnoreCase){"notepad","mspaint","calc","CalculatorApp","SnippingTool","wordpad","charmap"};
  static List<(IntPtr handle,int pid,string title)> AppWindows(){
    var windows=new List<(IntPtr,int,string)>();
    EnumWindows((hwnd,_)=>{if(!IsWindowVisible(hwnd)||GetWindow(hwnd,4)!=IntPtr.Zero)return true;string title=WindowTitle(hwnd);if(string.IsNullOrWhiteSpace(title))return true;GetWindowThreadProcessId(hwnd,out uint pid);if(pid>0&&pid<=int.MaxValue)windows.Add((hwnd,(int)pid,title));return true;},IntPtr.Zero);
    return windows;
  }
  static RunningApp? DescribeProcess(int pid,string title){
    try{
      using var process=Process.GetProcessById(pid);string processName=process.ProcessName;
      if(pid==Environment.ProcessId||process.SessionId!=Process.GetCurrentProcess().SessionId||protectedProcesses.Contains(processName)||process.HasExited)return null;
      string executable=process.MainModule?.FileName??"";if(executable.Length==0)return null;
      string windows=Environment.GetFolderPath(Environment.SpecialFolder.Windows).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
      if(executable.StartsWith(windows,StringComparison.OrdinalIgnoreCase)&&!windowsInteractiveProcesses.Contains(processName))return null;
      string ownDirectory=AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
      if(executable.StartsWith(ownDirectory,StringComparison.OrdinalIgnoreCase))return null;
      string name=processName;try{string description=FileVersionInfo.GetVersionInfo(executable).FileDescription??"";if(!string.IsNullOrWhiteSpace(description))name=description;}catch{}
      return new(pid,process.StartTime.ToUniversalTime().Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture),name,processName,title);
    }catch{return null;}
  }
  static RunningApp[] RunningApps()=>AppWindows().GroupBy(w=>w.pid).Select(g=>DescribeProcess(g.Key,g.First().title)).Where(p=>p!=null).Cast<RunningApp>().OrderBy(p=>p.name,StringComparer.OrdinalIgnoreCase).ToArray();
  static object CloseApp(int pid,string startTime){
    if(pid<=0||string.IsNullOrWhiteSpace(startTime))throw new Exception("Choose an application from the running applications list first");
    var windows=AppWindows().Where(w=>w.pid==pid).ToArray();
    var app=windows.Length>0?DescribeProcess(pid,windows[0].title):null;
    if(app==null)throw new Exception("Application is no longer running, has no visible window, or cannot be closed safely");
    if(app.startTime!=startTime)throw new Exception("Application changed since it was selected. Refresh the running applications list");
    // Retain a handle to this process while requesting close, so PID reuse cannot target another application.
    using var process=Process.GetProcessById(pid);_=process.Handle;
    if(process.StartTime.ToUniversalTime().Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture)!=startTime)throw new Exception("Application changed since it was selected");
    int requested=0;
    foreach(var window in windows){GetWindowThreadProcessId(window.handle,out uint currentPid);if(currentPid==pid&&PostMessage(window.handle,0x0010,IntPtr.Zero,IntPtr.Zero))requested++;}
    if(requested==0)return new{ok=false,closed=false,status="refused",app.pid,app.name,error="Windows refused the close request"};
    var watch=Stopwatch.StartNew();
    while(watch.ElapsedMilliseconds<3000){
      if(process.HasExited||!AppWindows().Any(w=>w.pid==pid))return new{ok=true,closed=true,status="closed",app.pid,app.name};
      Thread.Sleep(100);
    }
    return new{ok=false,closed=false,status="still_open",app.pid,app.name,error="Application is still open. It may be asking to save a document or may not be responding. Nothing was forcefully terminated.",remainingWindows=AppWindows().Where(w=>w.pid==pid).Select(w=>w.title).ToArray()};
  }
  static void Press(ushort key){Send(new[]{Input(key,false),Input(key,true)});}
  static void KeyChord(ushort modifier,ushort key){ushort[] held=new ushort[]{0xA0,0xA1,0xA2,0xA3,0xA4,0xA5,0x5B,0x5C}.Where(k=>(GetAsyncKeyState(k)&0x8000)!=0).ToArray();var sequence=held.Select(k=>Input(k,true)).ToList();sequence.AddRange(new[]{Input(modifier,false),Input(key,false),Input(key,true),Input(modifier,true)});sequence.AddRange(held.Select(k=>Input(k,false)));Send(sequence.ToArray());}
  static void PlayTone(int frequency){try{const int rate=16000,count=1120;using var data=new MemoryStream();using(var wave=new BinaryWriter(data,System.Text.Encoding.ASCII,true)){wave.Write(System.Text.Encoding.ASCII.GetBytes("RIFF"));wave.Write(36+count*2);wave.Write(System.Text.Encoding.ASCII.GetBytes("WAVEfmt "));wave.Write(16);wave.Write((short)1);wave.Write((short)1);wave.Write(rate);wave.Write(rate*2);wave.Write((short)2);wave.Write((short)16);wave.Write(System.Text.Encoding.ASCII.GetBytes("data"));wave.Write(count*2);for(int i=0;i<count;i++){double envelope=Math.Sin(Math.PI*i/count);wave.Write((short)(Math.Sin(2*Math.PI*frequency*i/rate)*1800*envelope));}}data.Position=0;using var player=new System.Media.SoundPlayer(data);player.PlaySync();}catch{}}
  static void StopAudio(){lock(playbackLock){playback?.Stop();}}
  static void PlayAudio(string file,bool deleteAfter){
    if(!File.Exists(file))throw new Exception("Audio file not found");StopAudio();AudioFileReader? reader=null;WaveOutEvent? player=null;
    try{reader=new AudioFileReader(file);player=new WaveOutEvent();var ownReader=reader;var ownPlayer=player;player.PlaybackStopped+=(_,e)=>{lock(playbackLock){if(ReferenceEquals(playback,ownPlayer))playback=null;}ownPlayer.Dispose();ownReader.Dispose();if(deleteAfter)try{File.Delete(file);}catch{}if(e.Exception!=null)Emit(new{type="error",error=e.Exception.Message});};player.Init(reader);lock(playbackLock){playback=player;}player.Play();}
    catch{lock(playbackLock){if(ReferenceEquals(playback,player))playback=null;}player?.Dispose();reader?.Dispose();if(deleteAfter)try{File.Delete(file);}catch{}throw;}
  }
  static INPUT Input(ushort vk,bool up)=>new(){type=1,U=new UNION{ki=new KEYBDINPUT{wVk=vk,dwFlags=up?2u:0u}}};
  static void Send(INPUT[] data){if(SendInput((uint)data.Length,data,Marshal.SizeOf<INPUT>())!=data.Length)throw new Exception("Windows refused keyboard input; target may require elevation");}
  delegate IntPtr HookProc(int n,IntPtr w,IntPtr l);
  [StructLayout(LayoutKind.Sequential)] struct INPUT{public uint type;public UNION U;}
  [StructLayout(LayoutKind.Explicit)] struct UNION{[FieldOffset(0)]public KEYBDINPUT ki;[FieldOffset(0)]public MOUSEINPUT mi;}
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT{public ushort wVk,wScan;public uint dwFlags,time;public UIntPtr dwExtraInfo;}
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT{public int dx,dy;public uint mouseData,dwFlags,time;public UIntPtr dwExtraInfo;}
  [DllImport("user32.dll",SetLastError=true)]static extern uint SendInput(uint n,INPUT[] inputs,int size);
  [DllImport("user32.dll")]static extern IntPtr SetWindowsHookEx(int id,HookProc proc,IntPtr mod,uint tid);
  [DllImport("user32.dll")]static extern bool UnhookWindowsHookEx(IntPtr h);
  [DllImport("user32.dll")]static extern IntPtr CallNextHookEx(IntPtr h,int n,IntPtr w,IntPtr l);
  [DllImport("user32.dll")]static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetWindowText(IntPtr h,System.Text.StringBuilder text,int length);
  delegate bool EnumWindowProc(IntPtr hwnd,IntPtr state);
  [DllImport("user32.dll")]static extern bool EnumWindows(EnumWindowProc callback,IntPtr state);
  [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")]static extern IntPtr GetWindow(IntPtr hwnd,uint command);
  [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll",SetLastError=true)]static extern bool PostMessage(IntPtr hwnd,uint message,IntPtr wParam,IntPtr lParam);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)]static extern IntPtr GetModuleHandle(string? name);
  [DllImport("kernel32.dll")]static extern uint GetACP();
}
