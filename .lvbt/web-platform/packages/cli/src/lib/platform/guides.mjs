/**
 * What the standard knows about the services behind a manifest: the DNS
 * records an email provider needs, the dashboard pages to open, and the
 * click-by-click steps for the parts no API can do. Keeping them here means
 * every repository gets the same, reviewed instructions.
 *
 * Every guide assumes the person has never used the service before, so each
 * step says exactly what to type or choose, and where a copied value goes.
 * A guide never asks for a second copy before the first is pasted: each
 * copied value goes into its destination (this command's prompt, a
 * dashboard field, a file) straight away, and a value needed in two places
 * is pasted in both before anything else is copied.
 * The labels follow the dashboards as they were on 2026-09-23 and the
 * providers' own documentation:
 *   - developers.cloudflare.com/cloudflare-one/setup/
 *   - developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google-workspace/
 *   - developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
 *   - developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/
 *   - developers.cloudflare.com/turnstile/get-started/
 *   - developers.cloudflare.com/fundamentals/api/get-started/create-token/
 *   - resend.com/docs/knowledge-base/cloudflare and resend.com/docs/dashboard/domains/regions
 */

export const ZERO_TRUST = 'https://one.dash.cloudflare.com/';

/**
 * LVBT's Zero Trust organization. The team domain is what Access signs
 * tokens with and what Google redirects to; the team name is only a label.
 */
export const LVBT_TEAM_SUBDOMAIN = 'lvbt';
export const LVBT_TEAM_DOMAIN = `${LVBT_TEAM_SUBDOMAIN}.cloudflareaccess.com`;
export const LVBT_TEAM_NAME = 'Las Vegans for Better Transit';
/** LVBT's one Google Cloud project, which holds every OAuth client and service account. */
export const LVBT_GOOGLE_PROJECT = 'LVBT Core';
export const LVBT_GOOGLE_PROJECT_ID = 'lvbt-core';
/** The shared LVBT address used as a contact wherever a service asks for one. */
export const LVBT_SHARED_EMAIL = 'tech@lasvegasfortransit.org';
/** The LVBT Cloudflare account's name. */
export const LVBT_CLOUDFLARE_ACCOUNT = 'Las Vegans for Better Transit';
/**
 * The account still carries an old, misspelled name in the dashboard. Every
 * guide that opens Cloudflare and chooses the account repeats this check, so
 * whoever notices it fixes it once instead of copying the wrong name onward.
 */
const ACCOUNT_NAME_CHECK = `If the account switcher still shows "Las Vegas for Better…" instead of "${LVBT_CLOUDFLARE_ACCOUNT}", open Manage Account and rename it to "${LVBT_CLOUDFLARE_ACCOUNT}" first.`;

const REGIONS = {
  'us-east-1': 'North Virginia (us-east-1)',
  'eu-west-1': 'Ireland (eu-west-1)',
  'sa-east-1': 'São Paulo (sa-east-1)',
  'ap-northeast-1': 'Tokyo (ap-northeast-1)',
};

/** Normalize a DNS-over-HTTPS answer: TXT data arrives quoted and sometimes split. */
export function dnsText(data) {
  return data.replace(/"\s+"/g, '').replace(/^"|"$/g, '');
}

/** A name as the Cloudflare DNS page wants it: relative to the zone, or @ for the zone itself. */
export function relativeName(name, zone) {
  if (name === zone) return '@';
  return name.endsWith(`.${zone}`) ? name.slice(0, -(zone.length + 1)) : name;
}

/** The DNS records an email provider needs for a sending domain. */
export function emailRecords(email) {
  const region = email.region ?? 'us-east-1';
  const domain = email.domain;
  const mailFrom = `feedback-smtp.${region}.amazonses.com`;
  return [
    {
      key: 'mx',
      type: 'MX',
      name: `send.${domain}`,
      purpose: 'returns bounces to Resend',
      expected: `MX send → ${mailFrom}, priority 10`,
      matches: (data) => data.replace(/\.$/, '').endsWith(mailFrom),
      level: 'required',
    },
    {
      key: 'spf',
      type: 'TXT',
      name: `send.${domain}`,
      purpose: 'allows Resend to send for the domain (SPF)',
      expected: 'TXT send → "v=spf1 include:amazonses.com ~all"',
      matches: (data) =>
        dnsText(data).startsWith('v=spf1') && dnsText(data).includes('include:amazonses.com'),
      level: 'required',
    },
    {
      key: 'dkim',
      type: 'TXT',
      name: `resend._domainkey.${domain}`,
      purpose: 'signs every message (DKIM)',
      expected: 'TXT resend._domainkey → the p=… value Resend shows',
      matches: (data) => dnsText(data).startsWith('p='),
      level: 'required',
    },
    {
      key: 'dmarc',
      type: 'TXT',
      name: `_dmarc.${domain}`,
      purpose: 'tells inboxes what to do with mail that fails the checks (DMARC)',
      expected: 'TXT _dmarc → "v=DMARC1; p=none;"',
      matches: (data) => dnsText(data).startsWith('v=DMARC1'),
      level: 'recommended',
    },
  ];
}

export function resendDomainGuide(email, cloudflare) {
  const region = email.region ?? 'us-east-1';
  const zone = cloudflare.zone.name;
  const [mx, spf, dkim, dmarc] = emailRecords(email).map((record) => ({
    ...record,
    short: relativeName(record.name, zone),
  }));
  return {
    url: 'https://resend.com/domains',
    steps: [
      'Sign in to Resend at https://resend.com/login. If you have no account, sign up at https://resend.com/signup with your @lasvegasfortransit.org address, then ask a maintainer to invite you to the LVBT team. Everything below belongs in that team, never in a personal one.',
      `On the Domains page, if ${email.domain} is listed, click it and go to the next step. Otherwise click "Add Domain", type ${email.domain}, choose the region ${REGIONS[region] ?? region}, and click "Add". Keep that region: platform.json and the DNS records both name it.`,
      `The easiest way to add the DNS records is the "Sign in to Cloudflare" button on the domain's page in Resend. Approve the request in the Cloudflare window, and it adds every record for you.`,
      `To add them by hand instead, open https://dash.cloudflare.com/${cloudflare.accountId}/${zone}/dns/records and add these three, each with TTL "Auto" and Proxy status "DNS only": type MX, name ${mx.short}, mail server feedback-smtp.${region}.amazonses.com, priority 10; type TXT, name ${spf.short}, content v=spf1 include:amazonses.com ~all; type TXT, name ${dkim.short}, content the long p=… value Resend shows for it.`,
      `Add the DMARC record too, which Resend recommends: type TXT, name ${dmarc.short}, content v=DMARC1; p=none;.`,
      'Back in Resend, click "Verify DNS Records". Wait until the domain\'s status says "Verified", usually within a few minutes (DNS can take up to 72 hours). Then run this command again.',
    ],
  };
}

export function zeroTrustGuide(manifest) {
  const secrets = [...new Set((manifest?.access ?? []).map((app) => app.teamDomainSecret))];
  const holds = secrets.length > 0 ? secrets.join(' and ') : 'ACCESS_TEAM_DOMAIN';
  return {
    url: ZERO_TRUST,
    steps: [
      `Open Cloudflare One and choose the LVBT account (${LVBT_CLOUDFLARE_ACCOUNT}). These steps appear only the first time Zero Trust is used in an account. ${ACCOUNT_NAME_CHECK}`,
      `Cloudflare asks you to choose the team domain (its documentation calls this the team name). Type ${LVBT_TEAM_SUBDOMAIN}, so the team domain becomes ${LVBT_TEAM_DOMAIN}. That is the address of the sign-in page, the value ${holds} holds, and the start of the Google sign-in addresses.`,
      `If it also asks for a team name, type ${LVBT_TEAM_NAME}. The team name is only a label people see; it changes nothing in any configuration.`,
      'Choose the Zero Trust Free plan. Cloudflare asks for payment details even for the Free plan, but does not charge for it.',
      'Finish the onboarding, then run this command again. It will find Zero Trust turned on and carry on from there.',
      `Later, Cloudflare One → Overview → Account details shows the Team domain and the Team name, each with a pencil icon that edits it. Do not change the team domain: the admin sign-in and the Google sign-in stop working until ${holds} and the Google OAuth client are updated to match.`,
    ],
  };
}

/** Where to copy the team domain from, for when setup cannot read it itself. */
export function teamDomainGuide(secretName) {
  return {
    url: ZERO_TRUST,
    steps: [
      `Open Cloudflare One and choose the LVBT account (${LVBT_CLOUDFLARE_ACCOUNT}). If it shows its first-time setup instead, Zero Trust was never turned on for this account: press Enter to skip, and run this command with the Cloudflare token it asks for, so it can show those steps. ${ACCOUNT_NAME_CHECK}`,
      `On Overview, find Account details. It shows the Team domain (for LVBT, ${LVBT_TEAM_DOMAIN}) and the Team name ("${LVBT_TEAM_NAME}"), which is only a label. ${secretName} needs the domain.`,
      "Copy the Team domain, without https://, and paste it at this command's prompt.",
    ],
  };
}

export function googleWorkspaceGuide(teamDomain, workspaceDomain, group) {
  const team = teamDomain ?? LVBT_TEAM_DOMAIN;
  const domain = workspaceDomain ?? 'lasvegasfortransit.org';
  const project = `?project=${LVBT_GOOGLE_PROJECT_ID}`;
  return {
    url: `https://console.cloud.google.com/home/dashboard${project}`,
    steps: [
      `Do the Google steps signed in as a Google Workspace super admin for ${domain}: turning on "Trust internal apps" and approving group access both need one. The Cloudflare steps need a Cloudflare user who can administer the LVBT account.`,
      `Use LVBT's one Google Cloud project, "${LVBT_GOOGLE_PROJECT}" (ID ${LVBT_GOOGLE_PROJECT_ID}); every link below opens it. If the project picker at the top shows no such project, click "New project", name it ${LVBT_GOOGLE_PROJECT}, make sure "Organization" is ${domain} so the project belongs to LVBT rather than to your own account, and click "Create". If Google shows a Free Trial banner, dismiss it: none of this needs billing.`,
      `Open https://console.cloud.google.com/apis/library/admin.googleapis.com${project} and click "Enable" on "Admin SDK API" (it says "Manage" instead if it is already on). Access uses it to read which Google Groups a person is in.`,
      'Open https://admin.google.com/ac/owl (Security → Access and data control → API controls), click "Settings", turn on "Trust internal apps", and save. It is off by default, and Access needs it.',
      'In a new browser tab, open Cloudflare One, go to Integrations → Identity providers (not "Cloud & SaaS" just above it: that is a different feature that asks for a service account; leave it alone), click "Add new identity provider", then "Google Workspace". Keep this tab open: two of the next steps fill it in, one value at a time.',
      `Back in Google Cloud, open https://console.cloud.google.com/auth/clients${project}. If it says "Google Auth Platform not configured yet", click "Get started" and complete its four steps: App Information: App name ${LVBT_TEAM_NAME}, User support email ${LVBT_SHARED_EMAIL} (a shared LVBT address, never a person's), then "Next"; Audience: "Internal", then "Next"; Contact Information: ${LVBT_SHARED_EMAIL}, then "Next"; Finish: tick the box agreeing to the Google API Services: User Data Policy, click "Continue", then "Create". Optionally, under "Branding", upload the square LVBT logo from the "Marketing & Communications" shared drive as the App logo. Then open "Clients" again.`,
      `On the Clients page, if a client named "Cloudflare Access" is listed, click it, check that it has the two addresses below, and under "Client secrets" click "Add secret", because Google shows a secret only when it is made. Otherwise click "Create client", choose the application type "Web application", and name it Cloudflare Access.`,
      `Under "Authorized JavaScript origins", click "Add URI" and enter exactly https://${team}`,
      `Under "Authorized redirect URIs", click "Add URI" and enter exactly https://${team}/cdn-cgi/access/callback, then click "Create" (or "Save").`,
      'Skip "Credentials" → "Service Accounts" and domain-wide delegation: nothing here uses a service account key, and GitHub Actions authenticates without one. Leave "Disable service account key creation" on if the project asks.',
      'Google shows the Client ID and the Client secret. Copy the Client ID (it ends in .apps.googleusercontent.com) and paste it into "App ID" in the Cloudflare tab.',
      'Copy the Client secret and paste it into "Client secret" in the Cloudflare tab. Neither value is stored in GitHub or on the Worker.',
      `In the Cloudflare tab, type ${domain} as the Google Workspace domain. Leave "Proof Key for Code Exchange (PKCE)" on; only turn it off if "Test" (a later step) fails with a code-verifier error. Leave "Enable SCIM" off, along with "Enable user deprovisioning" and "Remove user seat on deprovision", and leave the SCIM identity update behavior as "No action": Google Workspace only sends SCIM to a handful of apps in its own catalog, and Cloudflare does not document SCIM support for Google Workspace at all; Access re-checks group membership every sign-in instead. Leave the email claim and OIDC Claims fields empty. Click "Save".`,
      'Cloudflare then shows a link. Open it signed in as the Google Workspace super admin and approve it, so Access can read group membership.',
      `Back in Integrations → Identity providers, click "Test" next to Google Workspace. It should show your name and your groups${group ? `, including ${group}; add yourself to that group first (the Google Group step shows how), or the test cannot show it` : ''}. Then run this command again.`,
    ],
  };
}

/** A host-and-path destination split the way the "Add public hostname" form asks for it. */
export function hostnameParts(destination, zone) {
  const slash = destination.indexOf('/');
  const host = slash === -1 ? destination : destination.slice(0, slash);
  const path = slash === -1 ? '' : destination.slice(slash + 1);
  const inZone = host === zone || host.endsWith(`.${zone}`);
  const subdomain = inZone && host !== zone ? host.slice(0, -(zone.length + 1)) : '';
  return { subdomain, domain: inZone ? zone : host, path };
}

function describeHostname({ subdomain, domain, path }) {
  const parts = [
    subdomain ? `Subdomain ${subdomain}` : 'Subdomain empty',
    `Domain ${domain}`,
    path ? `Path ${path}` : 'Path empty',
  ];
  return parts.join(', ');
}

function sessionLabel(duration) {
  const match = /^(\d+)(m|h)$/.exec(duration);
  if (!match) return duration;
  const unit = match[2] === 'h' ? 'hour' : 'minute';
  return `${match[1]} ${unit}${match[1] === '1' ? '' : 's'}`;
}

function includeRule(app) {
  if (app.allow.googleGroup) {
    const domain = app.allow.googleGroup.split('@')[1];
    return `In the policy, add one Include rule: choose the selector "Google Groups" (an older Cloudflare UI calls this "Google Workspace groups") and enter ${app.allow.googleGroup}. That selector is offered only once Google Workspace is a login method; if it is missing, the Google Workspace step was not done. Until it is, choose "Emails" instead and enter the @${domain} address of each person who needs in now; this command replaces that rule with the group once Google Workspace is connected. Then click "+ Add require (AND)" and add a second condition, selector "Emails ending in", value @${domain}, as defence in depth.`;
  }
  if (app.allow.emailDomain)
    return `In the policy, add one Include rule: choose the selector "Emails ending in" and enter @${app.allow.emailDomain}.`;
  return `In the policy, add one Include rule: choose the selector "Emails" and enter ${app.allow.emails.join(', ')}.`;
}

function identitySteps(app) {
  if (app.identityProvider !== 'google-apps')
    return [
      'Under "Authentication", on the "Identity" tab, turn off "Accept all available identity providers", choose only "One-time PIN" in "Choose available identity providers", and turn on "Apply instant authentication". Leave "Authenticate with Cloudflare One Client" off.',
    ];
  return [
    'Under "Authentication", on the "Identity" tab, turn off "Accept all available identity providers" (it is on by default). In "Choose available identity providers", choose only "Google Workspace". Turn on "Apply instant authentication". Leave "Authenticate with Cloudflare One Client" off.',
    'If "Google Workspace" is not in that list, the Google Workspace sign-in step was not done. Choose "One-time PIN" for now; this command switches it to Google Workspace once it is connected.',
  ];
}

/**
 * Creating an Access application by hand, from a dashboard that has never
 * had one, then copying its audience tag. The steps follow the "Create new
 * self-hosted application" page from top to bottom. `audienceSteps` alone
 * say where the tag is, for when the application already exists. The exact
 * name matters: setup recognizes an application by its name, or else by its
 * paths, and would otherwise create a second one.
 */
export function accessAppGuide(app, zone) {
  const zoneName = zone ?? app.destinations[0].split('/')[0];
  const hostnames = app.destinations.map(
    (destination, index) =>
      `row ${index + 1}: ${describeHostname(hostnameParts(destination, zoneName))}`,
  );
  const policy = `${app.name} allow`;
  const audienceSteps = [
    `In Cloudflare One, go to Access controls → Applications and click "Configure" on "${app.name}".`,
    'On the "Additional settings" tab, under "Cookie settings", turn on "Enable Binding Cookie" if it is off. Leave "HTTP Only" on and "SameSite" set to "Lax".',
    `Still on "Additional settings", copy "Application Audience (AUD) Tag", and paste it at this command's prompt. It is 64 lowercase letters and digits, and it is the value ${app.audienceSecret} holds.`,
  ];
  const createSteps = [
    `Open Cloudflare One and choose the LVBT account (${LVBT_CLOUDFLARE_ACCOUNT}). Go to Access controls → Applications. If "${app.name}" is already listed, it exists: skip the steps that create it. ${ACCOUNT_NAME_CHECK}`,
    'Click "Create new application" at the top right (some screens say "Add an application"). An account with no applications yet shows only a list of prerequisites; the button is still at the top right.',
    'In the "Add an application" dialog, under "Self-hosted and private", choose the "Public DNS" tab. Do not choose "Private destinations", "Workers", or "Service auth". Click "Continue with Self-hosted and private". The page is now "Create new self-hosted application"; work down it from the top.',
    'Under "Destinations" there should be public hostname rows. If you see a "Private IPs" row with "Private IP address" and "Port" instead, "Private destinations" was chosen: click "+ Add public hostname", then remove the empty private row, or go back and choose "Public DNS".',
    `Add one public hostname row per address with "+ Add public hostname", leaving any other box empty: ${hostnames.join('; ')}. A path does not cover the paths under it, and a wildcard does not cover its parent, so every row is needed; with one missing, that part of the site would be open to anyone. Match each row's Subdomain box exactly, including a row that says "Subdomain empty" — the Subdomain box starts empty regardless of what a row calls for, and leaving it empty where a row names one puts the whole domain behind sign-in instead of only the part named.`,
    'Leave "Allow access through browser-based RDP, SSH, or VNC sessions" off.',
    `Under "Access policies", which says "No policy associated", open "Add current policies". If a policy named ${policy} is listed, choose it and go on to "Authentication". Otherwise click "Create new policy", name it exactly ${policy}, set the action to "Allow", and leave "Policy session duration" at its default, "Same as application session duration".`,
    includeRule(app),
    'Do not add a Country rule: it would lock out anyone who signs in while travelling, for little real protection, since the email or group rule above already limits who gets in.',
    'Leave "Override global multi-factor authentication settings (MFA)" and "Just-in-time access" off. MFA belongs in Google, not a Cloudflare Access rule: a Workspace admin enforces 2-Step Verification in the Google Admin console instead.',
    `Save the policy. If it opened in another tab, come back to this page and choose ${policy} in "Add current policies".`,
    'Skip "Policy tester".',
    ...identitySteps(app),
    'Skip "Preview".',
    `Under "Details", type the name exactly: ${app.name}. Set "Session Duration" to ${sessionLabel(app.sessionDuration ?? '24h')}, which is the default.`,
    'Click "Create".',
  ];
  return {
    url: ZERO_TRUST,
    audienceSteps,
    steps: [...createSteps, ...audienceSteps],
    /** For a run that asks for the tag later: make the application now, copy the tag then. */
    manualSteps: [
      ...createSteps,
      'Leave the tag for now. This command asks for it later in this run and shows where to find it.',
    ],
  };
}

/**
 * Creating the Google Group an Access application admits. Setup cannot read
 * Google Groups, so it asks the person to confirm the group exists and
 * remembers the answer on this computer.
 */
export function googleGroupGuide(group, apps) {
  const [local, domain] = group.split('@');
  const names = apps.map((app) => app.name).join(' and ');
  const session = sessionLabel(apps[0]?.sessionDuration ?? '24h');
  return {
    url: 'https://admin.google.com/ac/groups',
    steps: [
      `Do this as a Google Workspace admin with the Groups administrator privilege. The group decides who can sign in to ${names}.`,
      `Open the Google Admin console at https://admin.google.com and go to Menu → Directory → Groups. If ${group} is already listed, click it, then "Access settings", and check it before relying on it: "Who can join the group" is "Only invited users", and "Allow external members in the group" is off. Fix either if not, then skip to the step that adds members.`,
      'Click "Create group".',
      `Group name: ${names}. Group email: type ${local} and keep the domain ${domain}. Description: People who can sign in to ${names}. Group owner(s): add yourself and anyone who will add and remove people later.`,
      'Click "Next". Tick "Security", because the group controls access, and click "Next".',
      'Set Access type to "Restricted" and "Who can join the group" to "Only invited users". Leave "Allow external members in the group" off. Click "Create Group".',
      `Open the group, click "Members", then "Add members". Type each person's @${domain} address, including your own so you can test the sign-in, and click "Add To Group". Only accounts in the ${domain} Workspace can sign in through Access, so a personal Gmail address does not work, even in the group.`,
      `Later, to let someone in, open Directory → Groups → ${group} → Members and click "Add members". To take someone out, remove them from ${group} or suspend their Google account: point to them in the Members list and click "Remove", or Menu → Directory → Users → their name → "Suspend user". Either takes effect at their next sign-in, within ${session}. To end their access immediately instead of waiting, also go to Cloudflare One → Team & Resources → Users, find them, and revoke their session.`,
    ],
  };
}

export function turnstileGuide(widget, cloudflare, configPath) {
  const config = configPath ?? 'the production wrangler config';
  const mode = { managed: 'Managed', 'non-interactive': 'Non-interactive', invisible: 'Invisible' };
  const createSteps = [
    `Open Turnstile in the Cloudflare dashboard with the LVBT account (${LVBT_CLOUDFLARE_ACCOUNT}). If a widget named "${widget.name}" is already listed, click it and go to the step for the Site Key. ${ACCOUNT_NAME_CHECK}`,
    `Click "Add widget". Widget name: ${widget.name}.`,
    `Under "Hostname management", add ${widget.domains.join(', ')}.`,
    `Widget Mode: "${mode[widget.mode ?? 'managed']}". Leave pre-clearance off, and click "Create".`,
    `If "vars" in ${config} already has "${widget.siteKeyVar}" with this widget's Site Key, skip this step. Otherwise copy the Site Key (public, starts with 0x) and paste it into "vars" in ${config} as "${widget.siteKeyVar}" now; save the file and commit it through a pull request later.`,
  ];
  const secretSteps = [
    `Copy the widget's Secret Key (private, also starts with 0x) and paste it at this command's prompt. It is the Worker secret ${widget.secret}.`,
  ];
  return {
    url: `https://dash.cloudflare.com/${cloudflare.accountId}/turnstile`,
    secretSteps,
    steps: [...createSteps, ...secretSteps],
    /** For a run that asks for the secret later: make the widget now, copy the secret then. */
    manualSteps: [
      ...createSteps,
      'Leave the Secret Key for now. This command asks for it later in this run.',
    ],
  };
}

/** The pre-filled dashboard link for the token that manages Turnstile and Access. */
export function setupTokenUrl(manifest) {
  const permissions = [];
  if (manifest.turnstile?.length) permissions.push({ key: 'challenge_widgets', type: 'edit' });
  if (manifest.access?.length) {
    permissions.push({ key: 'access', type: 'edit' });
    permissions.push({ key: 'access_acct', type: 'read' });
  }
  const query = new URLSearchParams({
    permissionGroupKeys: JSON.stringify(permissions),
    accountId: manifest.cloudflare.accountId,
    zoneId: manifest.cloudflare.zone.id,
    name: `lvbt setup ${manifest.name}`,
  });
  return `https://dash.cloudflare.com/profile/api-tokens?${query}`;
}

export function setupTokenGuide(manifest) {
  const needed = [];
  if (manifest.turnstile?.length) needed.push('Turnstile · Edit');
  if (manifest.access?.length) {
    needed.push('Access: Apps and Policies · Edit');
    needed.push('Access: Organizations, Identity Providers, and Groups · Read');
  }
  return {
    url: setupTokenUrl(manifest),
    steps: [
      'The link opens Cloudflare\'s "Create Custom Token" page with the permissions filled in. Sign in with your LVBT Cloudflare account if it asks. This one is a personal token that expires tomorrow, because Cloudflare\'s account API tokens cannot manage Turnstile.',
      `Token name: lvbt setup ${manifest.name}.`,
      `Under "Permissions", check that there are exactly these rows, each set to "Account", and add any that is missing with "+ Add more": ${needed.join('; ')}.`,
      `Under "Account Resources", choose "Include" and the LVBT account, "${LVBT_CLOUDFLARE_ACCOUNT}" (ID ${manifest.cloudflare.accountId}), not "All accounts".`,
      'Under "TTL", set the End Date to tomorrow, so the token stops working by itself.',
      'Click "Continue to summary", then "Create Token". Click "Copy": Cloudflare shows the token only once.',
      "Paste it here. It stays in this terminal's memory and is never saved. When you finish, delete it at https://dash.cloudflare.com/profile/api-tokens.",
    ],
  };
}

export function varGuide(variable, configPath, value, widget) {
  const shown =
    value === undefined
      ? widget
        ? `"<the Site Key of the ${widget} Turnstile widget, which starts with 0x>"`
        : '"<value>"'
      : JSON.stringify(value);
  return {
    steps: [
      `Add "${variable.name}": ${shown} to "vars" in ${configPath}. It is public, so it belongs in the config rather than in a secret.`,
      'Commit it on a branch and open a pull request. The Worker gets it on the next deploy from main.',
    ],
  };
}
