import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Clapperboard,
  Film,
  Gamepad2,
  Globe2,
  HeartHandshake,
  Radio,
  ShoppingBag,
  UsersRound,
} from 'lucide-react';
import { Link } from 'react-router';
import { paths } from '@/shared/config/paths';
import { pictures, postAvatar } from '@/features/content/fixtures';
import AppTopbar from '@/shared/ui/AppTopbar';

export default function DiscoveryPage() {
  return (
    <div className="discovery-page discovery-studio">
      <AppTopbar
        className="discovery-topbar"
        appearance="plain"
        title="发现"
        actions={
          <span className="discovery-orbit" aria-hidden="true">
            <Globe2 size={23} strokeWidth={1.5} />
          </span>
        }
      />

      <Link className="discovery-activity" to={paths.moments} aria-label="动态">
        <img className="discovery-activity-cover" src={pictures.travel} alt="山野与晨光" />
        <div className="discovery-activity-shade" />
        <div className="discovery-activity-top">
          <span>朋友的日常</span>
          <span className="discovery-card-arrow">
            <ArrowUpRight size={19} />
          </span>
        </div>
        <div className="discovery-activity-bottom">
          <div>
            <h2>动态</h2>
            <p>看看朋友最近在做什么</p>
          </div>
          <span className="discovery-avatar-stack" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <img key={index} src={postAvatar(index)} alt="" />
            ))}
          </span>
        </div>
      </Link>

      <Link className="discovery-world" to={paths.world} aria-label="世界">
        <span className="discovery-world-icon">
          <Globe2 size={28} strokeWidth={1.6} />
        </span>
        <span className="discovery-entry-copy">
          <strong>世界</strong>
          <small>新鲜想法，在这里交汇</small>
        </span>
        <ChevronRight size={18} />
      </Link>

      <div className="discovery-section-heading">
        <h2>此刻精彩</h2>
        <span>看见更多生活</span>
      </div>
      <div className="discovery-media-grid">
        <Link className="discovery-media-card discovery-live" to={paths.live} aria-label="直播">
          <img src={pictures.city} alt="夜色中的城市" loading="lazy" />
          <span className="discovery-media-icon">
            <Radio size={20} />
          </span>
          <span className="discovery-live-pill">
            <i /> LIVE
          </span>
          <div>
            <strong>直播</strong>
            <small>一起在场</small>
          </div>
        </Link>
        <Link className="discovery-media-card discovery-video" to={paths.videos} aria-label="视频">
          <img src={pictures.sea} alt="湖畔与远山" loading="lazy" />
          <span className="discovery-media-icon">
            <Film size={20} />
          </span>
          <div>
            <strong>视频</strong>
            <small>把时间留给好内容</small>
          </div>
        </Link>
      </div>

      <section className="discovery-more" aria-label="更多发现">
        <Link to={paths.circles} aria-label="圈子">
          <span className="discovery-entry-icon discovery-circles-icon">
            <UsersRound size={24} strokeWidth={1.7} />
          </span>
          <span className="discovery-entry-copy">
            <strong>圈子</strong>
            <small>跟随创作者，找到共同的热爱</small>
          </span>
          <ChevronRight size={18} />
        </Link>
        <Link to={paths.matching} aria-label="匹配">
          <span className="discovery-entry-icon discovery-match-icon">
            <HeartHandshake size={24} strokeWidth={1.7} />
          </span>
          <span className="discovery-entry-copy">
            <strong>匹配</strong>
            <small>从共同兴趣开始，认识心动的人</small>
          </span>
          <ChevronRight size={18} />
        </Link>
        <Link to={paths.shorts} aria-label="短视频">
          <span className="discovery-entry-icon discovery-shorts-icon">
            <Clapperboard size={24} strokeWidth={1.7} />
          </span>
          <span className="discovery-entry-copy">
            <strong>短视频</strong>
            <small>一小段，刚刚好</small>
          </span>
          <ChevronRight size={18} />
        </Link>
        <Link to={paths.library} aria-label="小说">
          <span className="discovery-entry-icon discovery-reading-icon">
            <BookOpen size={24} strokeWidth={1.7} />
          </span>
          <span className="discovery-entry-copy">
            <strong>小说</strong>
            <small>下一页，另一个世界</small>
          </span>
          <ChevronRight size={18} />
        </Link>
        <Link to={paths.games} aria-label="游戏">
          <span className="discovery-entry-icon discovery-games-icon">
            <Gamepad2 size={24} strokeWidth={1.7} />
          </span>
          <span className="discovery-entry-copy">
            <strong>游戏</strong>
            <small>让灵感和快乐上线</small>
          </span>
          <ChevronRight size={18} />
        </Link>
        <Link to={paths.shop} aria-label="商城">
          <span className="discovery-entry-icon discovery-shop-icon">
            <ShoppingBag size={24} strokeWidth={1.7} />
          </span>
          <span className="discovery-entry-copy">
            <strong>商城</strong>
            <small>发现好物，装进喜欢的生活</small>
          </span>
          <ChevronRight size={18} />
        </Link>
      </section>
    </div>
  );
}
