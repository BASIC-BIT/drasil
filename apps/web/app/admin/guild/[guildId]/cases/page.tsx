import { redirect } from 'next/navigation';

export default async function QueuePage({
  params,
}: {
  readonly params: Promise<{ readonly guildId: string }>;
}) {
  const { guildId } = await params;
  redirect(`/admin/guild/${encodeURIComponent(guildId)}/inbox?kind=case`);
}
