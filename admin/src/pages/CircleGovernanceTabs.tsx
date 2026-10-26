import { NavLink } from 'react-router';

export default function CircleGovernanceTabs() {
  return (
    <nav className="circle-tabs" aria-label="圈子治理分区">
      <NavLink to="/circles" end>
        圈子治理
      </NavLink>
      <NavLink to="/circles/posts">圈帖审核</NavLink>
      <NavLink to="/circles/events">活动审核</NavLink>
    </nav>
  );
}
