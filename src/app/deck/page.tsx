import type { Metadata } from 'next';
import '@/styles/tokens.css';
import Deck from './Deck';

export const metadata: Metadata = {
  title: 'Longview deck',
  description: 'Longview: the acquisition agent that waits for the truth.',
};

type Search = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function DeckPage({ searchParams }: { searchParams: Search }) {
  const { print } = await searchParams;
  return <Deck print={print === '1'} />;
}
