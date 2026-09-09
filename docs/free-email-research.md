# Free email and domain options for TurnTally

Researched September 8, 2026. Scope: a U.S.-based family pilot needing occasional Supabase Auth recovery emails, with no purchased domain or paid email service. Two delegated reviews checked free DNS services and personal Gmail compatibility independently. Findings are based on provider documentation and public signup pages; no accounts were created, names registered, or emails sent.

## Recommendation

**First test a dedicated free Gmail account as Supabase's custom SMTP sender.** This can avoid buying a domain entirely. It is a practical candidate for the small family pilot, subject to account eligibility and a successful live delivery test. It is not a confirmed deployment or a recommendation for a large public service.

My earlier statement that a domain purchase was required was too broad. Resend requires a verified domain under your control; Supabase itself accepts SMTP providers generally. Google's personal Gmail documentation publishes authenticated SMTP settings and supports app passwords. Combining those documented capabilities supports the Gmail recommendation, but actual TurnTally delivery remains untested. [Gmail SMTP](https://support.google.com/mail/answer/7104828?hl=en), [Google app passwords](https://support.google.com/accounts/answer/185833?hl=en), [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Email-provider comparison

| Option | Ongoing free path | Domain requirement and decision |
|---|---|---|
| Dedicated personal Gmail | Free mailbox with authenticated SMTP; account limits apply | No purchased domain. Best first pilot experiment. Requires 2-Step Verification and an available app-password option. |
| Resend | 3,000 emails/month, 100/day | Requires a verified domain you control. A shared free subdomain's acceptance is unverified. Good option after domain ownership is settled. |
| SMTP2GO | 1,000 emails/month, 200/day | Signup requires a work/owned-domain email, excluding Gmail/Outlook/Yahoo addresses. Its single-sender verification feature does not remove that signup requirement. |
| Brevo | 300 emails/day | Documents temporary rewriting of unauthenticated/free sender addresses, including transactional messages. Provider explicitly calls it a stopgap, so do not rely on it as a permanent no-domain solution. |
| Mailjet | 6,000 emails/month, 200/day | Supports individual sender verification, but explicitly warns that free-mail sender messages may go to spam or fail delivery. Less attractive than sending a Gmail address through Google's own SMTP. |
| MailerSend sandbox | 100 emails/month, initially two recipients; no time limit | Includes a trial domain and SMTP user. Approval can remove the recipient limit, but its documentation explicitly positions this mode for testing, not production. Do not confuse it with a production free-domain offer. |

Sources: [Resend pricing](https://resend.com/docs/knowledge-base/what-is-resend-pricing), [Resend domain requirements](https://resend.com/docs/dashboard/domains/introduction), [SMTP2GO free plan](https://support.smtp2go.com/hc/en-gb/articles/223087947-Free-Plan), [SMTP2GO signup requirements](https://support.smtp2go.com/hc/en-gb/articles/12747932085145-Quick-Start-Guide), [Brevo free plan](https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan), [Brevo sender replacement](https://help.brevo.com/hc/en-us/articles/14925263522578-Comply-with-Gmail-Yahoo-and-Microsoft-s-requirements-for-email-senders), [Mailjet free limits](https://documentation.mailjet.com/hc/en-us/articles/360043048393-What-is-this-200-emails-per-day-limit-on-free-accounts), [Mailjet sender verification](https://documentation.mailjet.com/hc/en-us/articles/360042759253-How-to-add-a-sender-address), [MailerSend sandbox](https://www.mailersend.com/help/sandbox-mode-and-the-professional-trial).

Cloudflare now offers outbound SMTP, but arbitrary-recipient sending requires Workers Paid and a verified sending domain. Free sends to pre-verified destination addresses are a special case; this still does not supply a free sending domain. Our existing `workers.dev` app address can remain unchanged with any chosen mail provider. [Cloudflare pricing](https://developers.cloudflare.com/email-service/platform/pricing/), [domain configuration](https://developers.cloudflare.com/email-service/configuration/domains/).

## Free domains and subdomains

DNS control and email-provider acceptance are separate checks. Publishing MX/TXT records does not prove that an email provider will accept a shared parent domain, or that recipients will reliably receive mail.

| Service | What was verified | Assessment |
|---|---|---|
| FreeDNS / afraid.org | Public signup; free subdomains; MX/TXT including DKIM support | Best free DNS candidate to investigate. Prefer an operator-owned parent domain; the provider warns against long-term dependencies on other members' shared domains. Resend acceptance unverified. |
| dynv6 | Free service with public signup and named MX/TXT records | Technically suitable for experiments. Operator expressly discourages critical-service use because it lacks enterprise protection/SLA. |
| EU.org | Free subdomain requests, DNS delegation, applicants outside Europe allowed | Possible, but manual approval and current processing throughput remain unverified. Not a predictable release dependency. |
| deSEC / dedyn.io | Free registrations reopened in 2025; MX/TXT support | Poor fit here: staff describes it as residential dynamic DNS, reserves termination for other usage, and documents inactivity expiry. Free DNS hosting for an already-owned domain is a different service. |
| DuckDNS | Its documented API applies one TXT value to the hostname and deeper names | Unsuitable for our separate SPF/DKIM values through that interface. |
| NextDNS | Device DNS resolver/filtering | Does not provide the domain or authoritative records needed for sender verification. |

**FreeDNS does not state a blanket U.S. exclusion.** Its current signup checkbox concerns U.S. restricted lists and sanctioned territories. That differs from excluding ordinary U.S. residents. If another page or service produced a geographic block, that specific response still needs inspection. [Current signup](https://freedns.afraid.org/signup/).

Sources: [FreeDNS record types](https://freedns.afraid.org/faq/type.php), [FreeDNS ownership caveats](https://freedns.afraid.org/faq/), [dynv6 service](https://dynv6.com/), [dynv6 record API](https://dynv6.github.io/api-spec/), [EU.org registration](https://nic.eu.org/register.html), [EU.org eligibility](https://nic.eu.org/policy.html), [dedyn reopening](https://talk.desec.io/t/dyndns-service-down/823/21), [dedyn purpose and expiry](https://talk.desec.io/t/3-expiration-of-inactive-dyndns-domains/212/4), [deSEC records](https://desec.readthedocs.io/en/latest/dns/rrsets.html), [DuckDNS TXT API](https://www.duckdns.org/spec.jsp), [NextDNS](https://nextdns.io/).

## Proposed Gmail pilot test

Use a dedicated mailbox so the app credential is separate from personal correspondence. Google requires 2-Step Verification for app passwords; some account/security configurations do not offer them. Changing the Google account password revokes existing app passwords. If the option is unavailable, choose another provider rather than weakening an existing protected account. [Google account requirements](https://support.google.com/accounts/answer/185833?hl=en).

Google's current client guidance retains app passwords but discontinues ordinary account-password authentication. Do not follow the older SMTP page's stale advice about enabling less-secure apps. [Current Gmail client guidance](https://support.google.com/mail/answer/7126229?hl=en).

| Supabase SMTP field | Proposed value |
|---|---|
| Host | `smtp.gmail.com` |
| Port | `587` with STARTTLS |
| Username | The dedicated account's full Gmail address |
| Password | An app password entered directly into Supabase |
| Sender email | That same Gmail address |
| Sender name | `TurnTally` |

Google documents these SMTP settings; Supabase also documents Google SMTP, although its worked example uses paid Workspace, not a personal account. That example alone is not proof of personal-Gmail compatibility. [Personal Gmail SMTP](https://support.google.com/mail/answer/7104828?hl=en), [Supabase's Workspace example](https://supabase.com/docs/guides/troubleshooting/using-google-smtp-with-supabase-custom-smtp-ZZzU4Y).

Gmail's consumer limits can stop sending above 500 messages/day, and spam/abuse controls can intervene sooner; this is not a guaranteed SMTP allocation. Supabase's own mail rate limits also apply. Keep the pilot volume low and confirm delivery to the family's actual mailbox providers. [Gmail limits](https://support.google.com/mail/answer/22839?hl=en), [Supabase SMTP limits](https://supabase.com/docs/guides/auth/auth-smtp).

After the owner selects the sender and enters its credentials, configure the exact recovery redirect in [account recovery](account-recovery.md), deploy the tested UI, and run one approved end-to-end reset. Verify inbox delivery, password update, old-password rejection, used-link rejection, and unchanged family access. Never put the app password or recovery link into the repository or chat.
