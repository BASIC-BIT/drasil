import type { BrowserContext } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { Pool } from 'pg';
import { ownedTestDatabase } from '../../../scripts/owned-test-database.js';
import { encodeSignedJson, encryptJson } from '../lib/crypto';

export const workspaceIds = {
  guild: '910000000000000001',
  foreignGuild: '910000000000000002',
  actor: '910000000000000003',
  member: '910000000000000004',
  reporter: '910000000000000005',
  bot: '910000000000000006',
  channel: '910000000000000007',
  message: '910000000000000008',
  thread: '910000000000000009',
  case: '91000000-0000-4000-8000-000000000001',
  report: '91000000-0000-4000-8000-000000000002',
  linkedReport: '91000000-0000-4000-8000-000000000011',
  reportDetection: '91000000-0000-4000-8000-000000000012',
  detection: '91000000-0000-4000-8000-000000000003',
  observed: '91000000-0000-4000-8000-000000000004',
  early: '91000000-0000-4000-8000-000000000005',
  reportAttention: '91000000-0000-4000-8000-000000000006',
  support: '91000000-0000-4000-8000-000000000007',
  screening: '91000000-0000-4000-8000-000000000008',
  observedQueue: '91000000-0000-4000-8000-000000000009',
  breach: '91000000-0000-4000-8000-000000000010',
};
export const workspaceSecret = 'workspace-owned-test-secret';
export const fullStatement =
  'They sent me a reward link.\nI declined and they continued contacting me. This is the complete submitted statement.';
export const fullSource =
  'Complete channel source.\nSecond paragraph with the original link https://example.invalid/review and the complete closing sentence.';
const id = workspaceIds;
export function workspaceFixtures() {
  const pool = new Pool({ connectionString: ownedTestDatabase() });
  let server: Server | undefined;
  let unavailable = false;
  let unauthorized = false;
  let selectedOwner = true;
  let selectedPermissions = '8';
  let selectedRoleIds: string[] = [];
  let identityId: string = id.actor;
  const failures = new Map<string, number>();
  const malformedResponses = new Set<string>();
  const calls: string[] = [];
  async function start() {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      calls.push(`${request.method} ${url.pathname}`);
      response.setHeader('content-type', 'application/json');
      if (request.method !== 'GET') {
        response.writeHead(405);
        response.end('{}');
        return;
      }
      const source =
        url.pathname === '/users/@me/guilds'
          ? 'directory'
          : url.pathname === '/users/@me' && request.headers.authorization?.startsWith('Bearer ')
            ? 'identity'
            : url.pathname === `/guilds/${id.guild}`
              ? 'guild'
              : url.pathname.endsWith('/roles')
                ? 'roles'
                : url.pathname === `/guilds/${id.guild}/members/${id.actor}`
                  ? 'member'
                  : '';
      if (malformedResponses.has(source)) {
        response.writeHead(200);
        response.end('{"controlledMalformedResponse":');
        return;
      }
      const failure = failures.get(source);
      if (failure) {
        response.writeHead(failure, { 'Retry-After': '1' });
        response.end(JSON.stringify({ message: 'Controlled provider failure' }));
        return;
      }
      const guild = {
        id: id.guild,
        name: 'Moderation test server',
        owner: true,
        owner_id: id.actor,
        permissions: '8',
      };
      const channel = {
        id: id.channel,
        guild_id: id.guild,
        name: 'member-chat',
        type: 0,
        permission_overwrites: [],
      };
      const message = {
        id: id.message,
        channel_id: id.channel,
        author: { id: id.member, username: 'Case member' },
        content: fullSource,
        timestamp: '2026-10-21T14:40:00.000Z',
        attachments: [],
      };
      let body: unknown;
      if (url.pathname === '/users/@me/guilds') body = unauthorized ? [] : [guild];
      else if (url.pathname === '/users/@me')
        body = request.headers.authorization?.startsWith('Bearer ')
          ? { id: identityId, username: 'Test moderator' }
          : { id: id.bot, username: 'Test bot' };
      else if (url.pathname === `/guilds/${id.guild}`)
        body = { ...guild, owner_id: selectedOwner ? id.actor : id.bot };
      else if (url.pathname.endsWith('/roles'))
        body = [
          {
            id: id.guild,
            name: '@everyone',
            permissions: selectedPermissions,
            position: 0,
            managed: false,
          },
          {
            id: '910000000000000020',
            name: 'Staff',
            permissions: '0',
            position: 1,
            managed: false,
          },
        ];
      else if (url.pathname.includes('/members/'))
        body = {
          user: { id: url.pathname.split('/').at(-1) },
          roles: url.pathname.endsWith(id.actor) ? selectedRoleIds : [],
        };
      else if (url.pathname.endsWith('/channels')) body = [channel];
      else if (url.pathname.startsWith('/channels/')) {
        if (unavailable) {
          response.writeHead(404);
          response.end('{}');
          return;
        }
        if (url.pathname.includes('/messages/'))
          body = { ...message, channel_id: url.pathname.split('/')[2] };
        else if (url.pathname.endsWith('/messages')) body = [message];
        else body = { ...channel, id: url.pathname.split('/')[2] };
      } else {
        response.writeHead(404);
        response.end('{}');
        return;
      }
      response.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve, reject) => {
      server!.once('error', reject);
      server!.listen(34568, '127.0.0.1', resolve);
    });
  }
  async function reset(context: BrowserContext, origin: string) {
    ownedTestDatabase();
    unavailable = false;
    unauthorized = false;
    calls.length = 0;
    selectedOwner = true;
    selectedPermissions = '8';
    selectedRoleIds = [];
    identityId = id.actor;
    failures.clear();
    malformedResponses.clear();
    await pool.query(
      'update detection_events set latest_verification_event_id=null where server_id=any($1::text[])',
      [[id.guild, id.foreignGuild]]
    );
    await pool.query('delete from servers where guild_id=any($1::text[])', [
      [id.guild, id.foreignGuild],
    ]);
    await pool.query(
      'insert into servers(guild_id,is_active,settings) values($1,true,$3),($2,true,$3)',
      [
        id.guild,
        id.foreignGuild,
        JSON.stringify({
          moderator_ban_action_enabled: true,
          moderator_ban_action_requires_reason: true,
          moderator_kick_action_enabled: true,
          captcha_mode: 'manual',
          captcha_method: 'turnstile',
          captcha_method_revision: 1,
        }),
      ]
    );
    for (const [userId, name] of [
      [id.actor, 'Test moderator'],
      [id.member, 'Case member'],
      [id.reporter, 'Reporter'],
    ])
      await pool.query(
        'insert into users(discord_id,username) values($1,$2) on conflict(discord_id) do update set username=EXCLUDED.username',
        [userId, name]
      );
    await pool.query(
      'insert into server_members(server_id,user_id,discord_member_pending,discord_member_pending_since,discord_member_pending_last_checked_at) values($1,$2,true,$3,$3)',
      [id.guild, id.member, '2026-10-21T14:40:00Z']
    );
    await pool.query(
      "insert into report_intakes(id,server_id,reporter_id,status,confirmed_target_user_id,thread_id,created_at) values($1,$2,$3,'submitted',$4,$5,'2026-10-01T00:00:00Z'),($6,$2,$3,'collecting_evidence',null,$7,'2026-10-22T00:00:00Z')",
      [id.report, id.guild, id.reporter, id.member, id.thread, id.early, '910000000000000010']
    );
    await pool.query(
      "insert into report_intake_evidence(intake_id,kind,content,source_channel_id,source_message_id,metadata) values($1,'reporter_text',$2,$3,$4,'{}'),($1,'screenshot',null,null,null,$5)",
      [
        id.report,
        fullStatement,
        id.channel,
        id.message,
        JSON.stringify({
          url: 'https://example.invalid/screenshot.png',
          name: 'screenshot.png',
          contentType: 'image/png',
          size: 123,
        }),
      ]
    );
    await pool.query(
      "insert into detection_events(id,server_id,user_id,detection_type,confidence,reasons,detected_at,metadata) values($1,$2,$3,'user_report',0.8,ARRAY['Report requires review'],'2026-10-21T14:40:00Z',$4),($5,$2,$3,'gpt_analysis',0.9,ARRAY['Original recorded reason'],null,'{}')",
      [
        id.detection,
        id.guild,
        id.member,
        JSON.stringify({
          reportIntakeId: id.linkedReport,
          messageId: id.message,
          channelId: id.channel,
          messageContent: fullSource,
        }),
        id.observed,
      ]
    );
    await pool.query(
      "insert into report_intakes(id,server_id,reporter_id,status,confirmed_target_user_id) values($1,$2,$3,'submitted',$4)",
      [id.linkedReport, id.guild, id.reporter, id.member]
    );
    await pool.query(
      "insert into report_intake_evidence(intake_id,kind,content,source_channel_id,source_message_id) values($1,'reported_text',$2,$3,$4)",
      [id.linkedReport, fullSource, id.channel, id.message]
    );
    await pool.query(
      "insert into detection_events(id,server_id,user_id,detection_type,confidence,reasons,metadata) values($1,$2,$3,'user_report',0.8,ARRAY['Ordinary submitted report'],$4)",
      [id.reportDetection, id.guild, id.member, JSON.stringify({ reportIntakeId: id.report })]
    );
    await pool.query(
      "insert into verification_events(id,server_id,user_id,detection_event_id,thread_id,status,created_at) values($1,$2,$3,$4,$5,'pending','2026-10-21T14:40:00Z')",
      [id.case, id.guild, id.member, id.detection, id.thread]
    );
    await pool.query('update detection_events set latest_verification_event_id=$1 where id=$2', [
      id.case,
      id.detection,
    ]);
    await pool.query(
      "insert into moderation_queue_items(id,server_id,user_id,item_type,report_intake_id,source_thread_id,last_source_message_id) values($1,$2,$3,'report_thread_attention',$4,$5,$6)",
      [id.reportAttention, id.guild, id.reporter, id.early, id.thread, id.message]
    );
    await pool.query(
      "insert into moderation_queue_items(id,server_id,user_id,item_type,verification_event_id,source_thread_id,last_source_message_id) values($1,$2,$3,'support_thread_attention',$4,$5,$6),($7,$2,$3,'quarantine_breach_attention',$4,$5,$6)",
      [id.support, id.guild, id.member, id.case, id.channel, id.message, id.breach]
    );
    await pool.query(
      "insert into moderation_queue_items(id,server_id,user_id,item_type,metadata) values($1,$2,$3,'pending_screening_member','{\"threshold_days\":7}')",
      [id.screening, id.guild, id.member]
    );
    await pool.query(
      "insert into moderation_queue_items(id,server_id,user_id,item_type,detection_event_id) values($1,$2,$3,'observed_alert_mirror',$4)",
      [id.observedQueue, id.guild, id.member, id.observed]
    );
    const expiresAt = Date.now() + 3600000;
    await context.addCookies([
      {
        name: 'drasil_admin_session',
        value: encodeSignedJson(
          {
            userId: id.actor,
            username: 'Test moderator',
            avatarUrl: null,
            issuedAt: Date.now(),
            expiresAt,
          },
          workspaceSecret
        ),
        url: origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
      {
        name: 'drasil_discord_oauth',
        value: encryptJson(
          { accessToken: 'controlled-provider-token', expiresAt },
          workspaceSecret
        ),
        url: origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
  }
  async function finishCase(status: 'verified' | 'banned' = 'verified') {
    const result = await pool.query(
      "select id from moderation_action_requests where server_id=$1 and verification_event_id=$2 and status='queued' order by requested_at desc limit 1",
      [id.guild, id.case]
    );
    if (!result.rows[0]) throw new Error('Production mutation did not persist a queued request.');
    await pool.query(
      'update verification_events set status=$1,resolved_at=now(),updated_at=now() where id=$2',
      [status, id.case]
    );
    await pool.query(
      "update moderation_action_requests set status='completed',completed_at=now(),updated_at=now() where id=$1",
      [result.rows[0].id]
    );
    return result.rows[0].id as string;
  }
  return {
    start,
    reset,
    pool,
    calls,
    finishCase,
    setMalformedResponse: (source: 'identity' | 'roles', enabled: boolean) => {
      if (enabled) malformedResponses.add(source);
      else malformedResponses.delete(source);
    },
    setProviderFailure: (
      source: 'identity' | 'directory' | 'guild' | 'member' | 'roles',
      status?: number
    ) => {
      if (status === undefined) failures.delete(source);
      else failures.set(source, status);
    },
    setSelectedAuthority: (owner: boolean, permissions: string, roleIds: string[] = []) => {
      selectedOwner = owner;
      selectedPermissions = permissions;
      selectedRoleIds = roleIds;
    },
    setIdentity: (value: string) => {
      identityId = value;
    },
    setUnavailable: (value: boolean) => {
      unavailable = value;
    },
    setUnauthorized: (value: boolean) => {
      unauthorized = value;
    },
    async stop() {
      await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
      await pool.end();
    },
  };
}
