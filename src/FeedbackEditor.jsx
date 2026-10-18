import React,{useEffect,useRef,useState} from 'react';
import {Circle,Pencil,Undo2,Trash2,X,Send,LoaderCircle,Square,MessageSquare} from 'lucide-react';
import './feedback.css';

export function paintFeedback(ctx,image,marks){
  ctx.clearRect(0,0,ctx.canvas.width,ctx.canvas.height);ctx.drawImage(image,0,0,ctx.canvas.width,ctx.canvas.height);
  for(const mark of marks){
    const [start,end]=[mark.points[0],mark.points.at(-1)];if(!start||!end)continue;
    ctx.save();ctx.strokeStyle='#ff454f';ctx.lineWidth=Math.max(3,ctx.canvas.width/480);ctx.lineCap='round';ctx.lineJoin='round';
    if(mark.tool==='cover'){ctx.fillStyle='#111';ctx.fillRect(Math.min(start.x,end.x),Math.min(start.y,end.y),Math.abs(end.x-start.x),Math.abs(end.y-start.y));}
    else{ctx.beginPath();if(mark.tool==='circle')ctx.ellipse((start.x+end.x)/2,(start.y+end.y)/2,Math.abs(end.x-start.x)/2,Math.abs(end.y-start.y)/2,0,0,Math.PI*2);else{ctx.moveTo(start.x,start.y);for(const point of mark.points.slice(1))ctx.lineTo(point.x,point.y);}ctx.stroke();}ctx.restore();
  }
}
export default function FeedbackEditor(){
  const canvas=useRef(),image=useRef(),marks=useRef([]),live=useRef(null);
  const [capture,setCapture]=useState(null),[tool,setTool]=useState('circle'),[count,setCount]=useState(0),[text,setText]=useState(''),[sending,setSending]=useState(false),[error,setError]=useState('');
  const redraw=()=>{if(image.current&&canvas.current)paintFeedback(canvas.current.getContext('2d'),image.current,[...marks.current,...(live.current?[live.current]:[])]);};
  const close=()=>{if(!sending)window.voice.closeFeedback();};
  const undo=()=>{if(sending)return;marks.current.pop();setCount(marks.current.length);redraw();};
  useEffect(()=>{document.body.classList.add('feedback-body');let disposed=false;window.voice.feedbackCapture().then(data=>{if(disposed)return;if(!data?.image)throw Error('Снимок недоступен. Закрой окно и попробуй ещё раз.');setCapture(data);const img=new Image();img.onload=()=>{if(disposed)return;image.current=img;canvas.current.width=img.naturalWidth;canvas.current.height=img.naturalHeight;redraw();};img.onerror=()=>setError('Не удалось загрузить снимок.');img.src=data.image;}).catch(e=>setError(e.message));return()=>{disposed=true;document.body.classList.remove('feedback-body');};},[]);
  useEffect(()=>{const key=e=>{if(e.key==='Escape'){e.preventDefault();close();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA'].includes(e.target.tagName)){e.preventDefault();undo();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[sending]);
  const point=e=>{const rect=canvas.current.getBoundingClientRect();return{x:(e.clientX-rect.left)*canvas.current.width/rect.width,y:(e.clientY-rect.top)*canvas.current.height/rect.height};};
  const start=e=>{if(sending||!image.current||e.button!==0)return;const p=point(e);live.current={tool,points:[p,p]};e.currentTarget.setPointerCapture(e.pointerId);redraw();};
  const move=e=>{if(!live.current)return;const p=point(e);if(live.current.tool==='pen')live.current.points.push(p);else live.current.points[1]=p;redraw();};
  const finish=e=>{if(!live.current)return;move(e);const mark=live.current;live.current=null;const a=mark.points[0],b=mark.points.at(-1);if(mark.points.length>2||Math.hypot(a.x-b.x,a.y-b.y)>3)marks.current.push(mark);setCount(marks.current.length);redraw();};
  const submit=async e=>{e?.preventDefault();if(sending||!text.trim()||!capture?.connected||!image.current)return;setSending(true);setError('');try{await window.voice.sendFeedback({description:text.trim(),image:canvas.current.toDataURL('image/png')});}catch(e){setError(e.message.replace(/^Error invoking remote method '[^']+': Error: /,''));setSending(false);}};
  return <main className="feedback-editor" aria-label="Обращение в Codex">
    <canvas ref={canvas} className="feedback-canvas" aria-label="Снимок экрана: рисуй, удерживая левую кнопку мыши" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={()=>{live.current=null;redraw();}}/>
    <div className="feedback-toolbar" role="toolbar" aria-label="Разметка снимка">
      <span className="feedback-title"><MessageSquare size={17}/><b>Обведи проблему</b></span><span className="feedback-separator"/>
      {[['circle',Circle,'Обвести'],['pen',Pencil,'Карандаш'],['cover',Square,'Скрыть область']].map(([id,Icon,label])=><button key={id} type="button" title={label} aria-label={label} aria-pressed={tool===id} className={tool===id?'selected':''} disabled={sending} onClick={()=>setTool(id)}><Icon size={18}/></button>)}
      <span className="feedback-separator"/><button type="button" title="Отменить отметку · Ctrl+Z" aria-label="Отменить отметку" disabled={!count||sending} onClick={undo}><Undo2 size={18}/></button><button type="button" title="Очистить отметки" aria-label="Очистить отметки" disabled={!count||sending} onClick={()=>{marks.current=[];setCount(0);redraw();}}><Trash2 size={17}/></button>
      <span className="feedback-separator"/><button type="button" title="Закрыть · Esc" aria-label="Закрыть обращение" disabled={sending} onClick={close}><X size={19}/></button>
    </div>
    <form className="feedback-composer" onSubmit={submit}>
      <div className="feedback-heading"><label htmlFor="feedback-description">Что исправить?</label><span>{capture?.connected?'Этот чат Codex':'Codex не подключён'}</span></div>
      <textarea id="feedback-description" autoFocus placeholder="Например: эта кнопка не работает. Сделай, чтобы открывала файл." value={text} maxLength={6000} disabled={sending} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();submit();}}}/>
      {error&&<p className="feedback-error" role="alert">{error}</p>}
      <div className="feedback-footer"><span>В чат уйдут этот снимок с отметками и описание.</span><button type="submit" disabled={sending||!text.trim()||!capture?.connected}>{sending?<LoaderCircle size={16} className="spin"/>:<Send size={16}/>}<span>{sending?'Отправляю…':'Отправить в Codex'}</span></button></div>
    </form>
  </main>;
}
