import { useParams } from 'react-router';
import ComposePage from './pages/ComposePage';
import CoverPage from './pages/CoverPage';
import AuthorPage from './pages/AuthorPage';
import PostActionsPage from './pages/PostActionsPage';
import ShortCommentsPage from './pages/ShortCommentsPage';
import { BookPage, BookshelfPage, ChaptersPage, ReadingSettingsPage } from './pages/BookPages';
import GameResultsPage from './pages/GameResultsPage';
import {
  CommunityEventPage,
  CommunityFormPage,
  CommunityMembersPage,
} from './pages/CommunityPages';
import TopicsPage from './pages/TopicsPage';
import type { ContentRouteKind } from './types';
import './content.css';

export default function ContentRoutePage({ kind }: { kind: ContentRouteKind }) {
  const params = useParams();
  return <ContentRouteContent key={`${kind}-${JSON.stringify(params)}`} kind={kind} />;
}
function ContentRouteContent({ kind }: { kind: ContentRouteKind }) {
  switch (kind) {
    case 'compose':
      return <ComposePage />;
    case 'cover':
      return <CoverPage />;
    case 'profile':
      return <AuthorPage />;
    case 'post-actions':
      return <PostActionsPage />;
    case 'short-comments':
      return <ShortCommentsPage />;
    case 'book':
      return <BookPage />;
    case 'chapters':
      return <ChaptersPage />;
    case 'bookshelf':
      return <BookshelfPage />;
    case 'reading-settings':
      return <ReadingSettingsPage />;
    case 'game-results':
      return <GameResultsPage />;
    case 'community-create':
      return <CommunityFormPage />;
    case 'community-manage':
      return <CommunityFormPage editing />;
    case 'community-members':
      return <CommunityMembersPage />;
    case 'community-event':
      return <CommunityEventPage />;
    case 'topics':
      return <TopicsPage />;
  }
}
