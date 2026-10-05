import PublicBoard from '@/components/v3/PublicBoard';

export default async function PublicBoardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicBoard slug={slug} />;
}
