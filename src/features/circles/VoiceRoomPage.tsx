import { useEffect, useState } from 'react';
import {
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Radio,
  Settings2,
  Volume2,
} from 'lucide-react';
import { Link, useParams } from 'react-router';
import PageHeader from '@/shared/ui/PageHeader';
import { CircleAccessState, CircleAvatar } from './ChannelPage';
import { circlePaths } from './routes';
import { canManage, useCircles } from './useCircles';

export default function VoiceRoomPage() {
  const { circleId = '', channelId = '' } = useParams();
  return <VoiceRoomContent key={JSON.stringify([circleId, channelId])} />;
}

function VoiceRoomContent() {
  const { circleId = '', channelId = '' } = useParams();
  const { getCircle, getChannels, getMembers, canViewChannel } = useCircles();
  const circle = getCircle(circleId);
  const channel = getChannels(circleId).find((item) => item.id === channelId);
  const [joinedRoom, setJoinedRoom] = useState('');
  const joined = joinedRoom === `${circleId}/${channelId}`;
  const [muted, setMuted] = useState(false);
  const [deafened, setDeafened] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [left, setLeft] = useState(false);
  const allMembers = getMembers(circleId);
  const self = allMembers.find((member) => member.id === 'me');
  const members = allMembers.filter((member) => member.online && member.id !== 'me').slice(0, 5);
  useEffect(() => {
    if (!joined) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [joined]);
  const backTo = circle ? circlePaths.home(circleId) : circlePaths.list;
  const time = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  function join() {
    setJoinedRoom(`${circleId}/${channelId}`);
    setMuted(false);
    setDeafened(false);
    setSeconds(0);
    setLeft(false);
  }
  function leave() {
    setJoinedRoom('');
    setLeft(true);
  }
  return (
    <section className="circle-page circle-voice-page">
      <PageHeader
        title="语音房间"
        backTo={backTo}
        action={
          channel && canManage(circle) ? (
            <Link
              className="circle-content-settings"
              aria-label="频道设置"
              to={circlePaths.editChannel(circleId, channelId)}
            >
              <Settings2 size={20} />
            </Link>
          ) : undefined
        }
      />
      {!circle ? (
        <CircleAccessState title="圈子不存在" description="这个圈子可能已解散，或链接已经失效。" />
      ) : !channel || channel.type !== 'voice' ? (
        <CircleAccessState
          title="语音频道不存在"
          description="回到圈子，找一个房间坐坐吧。"
          circleId={circleId}
          joined={circle.joined}
        />
      ) : !circle.joined || !canViewChannel(circleId, channelId) ? (
        <CircleAccessState
          title={circle.joined ? '这是管理团队的语音房' : '加入圈子，一起聊聊'}
          description={
            circle.joined
              ? '这个房间仅对圈主和管理员开放。'
              : '成为圈子成员后，就可以进入语音房间。'
          }
          circleId={circleId}
          joined={circle.joined}
        />
      ) : (
        <div className="circle-voice-body">
          <div className="circle-voice-heading">
            <span className="circle-voice-symbol">
              <Volume2 size={38} />
            </span>
            <span className="circle-voice-circle">
              {circle.icon} {circle.name}
            </span>
            <h1>{channel.name}</h1>
            <p>{channel.description}</p>
            <div className={`circle-voice-status ${joined ? 'connected' : ''}`} role="status">
              {joined ? (
                <>
                  <Radio size={15} />
                  已加入 · {time}
                </>
              ) : left ? (
                `已离开房间 · 本次 ${time}`
              ) : (
                <>
                  <span />
                  {members.length} 位成员正在这里
                </>
              )}
            </div>
          </div>
          <div className="circle-voice-members" aria-label="房间成员">
            {members.map((member, index) => (
              <div
                className={`circle-voice-member ${joined && index === 0 && !deafened ? 'speaking' : ''}`}
                key={member.id}
              >
                <div>
                  <CircleAvatar name={member.name} src={member.avatar} size={72} />
                  <span className="circle-voice-member-mic">
                    <Mic size={13} />
                  </span>
                </div>
                <strong>{member.name}</strong>
                <small>
                  {member.role === 'owner'
                    ? '圈主'
                    : member.role === 'admin'
                      ? '管理员'
                      : '在线成员'}
                </small>
              </div>
            ))}
            {joined && (
              <div className={`circle-voice-member self ${!muted && !deafened ? 'speaking' : ''}`}>
                <div>
                  <CircleAvatar name={self?.name || '我'} src={self?.avatar} size={72} />
                  <span className="circle-voice-member-mic">
                    {muted || deafened ? <MicOff size={13} /> : <Mic size={13} />}
                  </span>
                </div>
                <strong>我</strong>
                <small>{deafened ? '耳机已关闭' : muted ? '已静音' : '麦克风已开启'}</small>
              </div>
            )}
          </div>
          <div className="circle-voice-controls">
            {joined ? (
              <>
                <button
                  aria-label={muted || deafened ? '取消静音' : '静音'}
                  aria-pressed={muted || deafened}
                  disabled={deafened}
                  onClick={() => setMuted(!muted)}
                >
                  {muted || deafened ? <MicOff size={23} /> : <Mic size={23} />}
                  <span>{muted || deafened ? '已静音' : '静音'}</span>
                </button>
                <button
                  aria-label={deafened ? '打开耳机' : '关闭耳机'}
                  aria-pressed={deafened}
                  onClick={() => setDeafened(!deafened)}
                >
                  {deafened ? <HeadphoneOff size={23} /> : <Headphones size={23} />}
                  <span>{deafened ? '耳机已关闭' : '耳机'}</span>
                </button>
                <button className="circle-voice-leave" onClick={leave}>
                  <PhoneOff size={23} />
                  <span>离开房间</span>
                </button>
              </>
            ) : (
              <button className="primary circle-voice-join" onClick={join}>
                <Phone size={20} />
                {left ? '重新加入语音' : '加入语音房间'}
              </button>
            )}
          </div>
          <p className="circle-voice-demo">语音房为本地模拟体验，不会访问麦克风或摄像头。</p>
        </div>
      )}
    </section>
  );
}
