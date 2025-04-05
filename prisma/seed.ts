import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log(`Start seeding ...`);

  const serverGuildId = '1249723747896918109';
  const serverData: Prisma.serversCreateInput = {
    guild_id: serverGuildId,
    restricted_role_id: '1354218905937121402',
    admin_channel_id: '1278730769572958238',
    verification_channel_id: '1355206974630793227',
    admin_notification_role_id: '1278730769572958238',
    // created_at handled by default
    // updated_at handled by default/update trigger
    settings: {
      // Prisma handles JSON automatically
      auto_restrict: true,
      use_gpt_on_join: true,
      message_threshold: 5,
      message_timeframe: 10,
      suspicious_keywords: ['free nitro', 'discord nitro', 'claim your prize'],
      message_retention_days: 7,
      gpt_message_check_count: 3,
      detection_retention_days: 30,
      min_confidence_threshold: 70,
    },
    is_active: true,
  };

  // Use upsert to match the ON CONFLICT DO UPDATE logic
  const server = await prisma.servers.upsert({
    where: { guild_id: serverGuildId },
    update: {
      // Fields to update if server exists
      restricted_role_id: serverData.restricted_role_id,
      admin_channel_id: serverData.admin_channel_id,
      verification_channel_id: serverData.verification_channel_id,
      admin_notification_role_id: serverData.admin_notification_role_id,
      settings: serverData.settings,
      is_active: serverData.is_active,
      updated_at: new Date(), // Explicitly set updated_at on update
    },
    create: serverData, // Fields to use if server doesn't exist
  });

  console.log(`Created/Updated server with guild_id: ${server.guild_id}`);

  console.log(`Seeding finished.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
