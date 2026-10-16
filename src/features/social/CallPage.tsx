import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { paths } from '@/shared/config/paths';
import { useProfile } from '@/features/profile/useProfile';
import { ConversationAvatar, PersonAvatar } from './Avatars';
import { SocialMissing } from './SocialPageParts';
import { useSocialActions } from './useSocialActions';

export default function CallPage() {
  const { conversationId, callMode } = useParams();
  const { conversations, appendMessage } = useSocialActions();
  const { profile } = useProfile();
  const conversation = conversations.find((item) => item.id === conversationId);
  const [phase, setPhase] = useState<'ringing' | 'connected' | 'ended'>('ringing');
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const [camera, setCamera] = useState(callMode === 'video');
  const finalised = useRef(false);
  const video = callMode === 'video';
  useEffect(() => {
    if (phase !== 'ringing') return;
    const timer = window.setTimeout(() => setPhase('connected'), 2500);
    return () => window.clearTimeout(timer);
  }, [phase]);
  useEffect(() => {
    if (phase !== 'connected') return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [phase]);
  if (!conversation || !['voice', 'video'].includes(callMode || '') || conversation.kind === 'file')
    return <SocialMissing title="通话不存在" backTo={paths.social} />;
  const duration = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  function end() {
    if (!conversation || finalised.current) return;
    finalised.current = true;
    appendMessage(
      conversation.id,
      `${video ? '视频' : '语音'}通话（模拟）${phase === 'ringing' ? '已取消' : `已结束 · ${duration}`}`,
    );
    setPhase('ended');
  }
  return (
    <section className="im-call-page">
      <div className="im-call-top">
        <Link to={paths.chat(conversation.id)} onClick={end} aria-label="结束并返回聊天">
          <ArrowLeft size={24} />
        </Link>
        <span>{video ? '视频通话' : '语音通话'} · 模拟体验</span>
      </div>
      {phase === 'ended' ? (
        <div className="im-call-result">
          <PhoneOff size={48} />
          <h1>通话已结束</h1>
          <p>
            与 {conversation.name} 的{video ? '视频' : '语音'}通话
          </p>
          <strong>{duration}</strong>
          <p>通话记录已保存到聊天中。</p>
          <Link className="im-primary" to={paths.chat(conversation.id)}>
            返回聊天
          </Link>
        </div>
      ) : (
        <>
          <div className={`im-call-stage ${video ? 'im-video-stage' : ''}`}>
            <ConversationAvatar conversation={conversation} />
            <h1>{conversation.name}</h1>
            <p>{phase === 'ringing' ? '正在呼叫，对方即将接听…' : `已连接 · ${duration}`}</p>
            {video && (
              <div className="im-call-self">
                <PersonAvatar name={profile.name} avatar={49} image={profile.avatar} />
                <small>{camera ? '模拟视频画面' : '摄像头已关闭'}</small>
              </div>
            )}
          </div>
          <p className="im-call-demo">
            本页使用模拟连接与画面，不访问麦克风、摄像头或真实网络通话。
          </p>
          <div className="im-call-controls">
            <button
              aria-label={muted ? '打开麦克风' : '静音麦克风'}
              aria-pressed={muted}
              onClick={() => setMuted(!muted)}
            >
              {muted ? <MicOff size={27} /> : <Mic size={27} />}
              <span>{muted ? '已静音' : '麦克风'}</span>
            </button>
            <button
              aria-label={speaker ? '关闭扬声器' : '打开扬声器'}
              aria-pressed={speaker}
              onClick={() => setSpeaker(!speaker)}
            >
              {speaker ? <Volume2 size={27} /> : <VolumeX size={27} />}
              <span>{speaker ? '扬声器' : '听筒'}</span>
            </button>
            {video && (
              <button
                aria-label={camera ? '关闭摄像头' : '打开摄像头'}
                aria-pressed={camera}
                onClick={() => setCamera(!camera)}
              >
                {camera ? <Video size={27} /> : <VideoOff size={27} />}
                <span>{camera ? '摄像头' : '已关闭'}</span>
              </button>
            )}
            <button className="im-call-hangup" aria-label="结束通话" onClick={end}>
              <PhoneOff size={28} />
              <span>挂断</span>
            </button>
          </div>
          {phase === 'ringing' && (
            <button className="im-call-connect" onClick={() => setPhase('connected')}>
              <Phone size={16} />
              立即模拟接听
            </button>
          )}
        </>
      )}
    </section>
  );
}
