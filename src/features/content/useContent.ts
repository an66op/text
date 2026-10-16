import { useContext } from 'react';
import { ContentContext } from './content-context';

export function useContent() {
  const value = useContext(ContentContext);
  if (!value) throw new Error('ContentProvider is missing');
  return value;
}
