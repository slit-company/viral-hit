# Service credits

Generation services bill their own accounts, and a run sent to an account without credit fails after the queue, the upload and sometimes a charge for a keyframe. Viral Hit keeps track of what it knows about each connected service's credit and uses it before anything is sent.

## Where the answer comes from

| Service | Source | Unit |
|---|---|---|
| fal | Platform API `GET /v1/account/billing?expand=credits` | USD (needs a key with billing read access; otherwise "unavailable") |
| Runway | `GET /v1/organization` `creditBalance` | credits |
| ElevenLabs | `GET /v1/user/subscription` (limit minus used) | characters |
| Higgsfield, Comfy, xAI, OpenAI, Gemini, Sume | No public balance API for these keys. A run that fails with a credit or billing error marks the service out of credit until a later run succeeds or you choose **I added credits** in Connections. | — |

Balance checks are read-only requests made only when you press **Check** or **Check balance**, when an agent asks with `viral_hit_service_credits` and `refresh`, when Cinema plans a shot (cached answers older than two minutes refresh in the background) and right before a paid submission (an answer older than a minute is refreshed first). Results are cached in `provider-status.json` in the data folder. Keys never leave the server, and a failed or forbidden check is shown as "unavailable", never as zero.

## What changes

- **Cinema auto routing** skips every service that is out of credit and adds a note such as "Skipped Runway: no credits left (0 credits)". When no service with credit can run the step, the plan explains which accounts to top up.
- **Any generation** (Studio, Canvas, recipes, agents, Cinema) is refused before submission when the service itself reported zero. A credit state inferred from a failed run never blocks a model you pick yourself, so you can retry after topping up.
- **Connections** shows each balance with the time it was checked, a red "Out of credit" note with the reason, **Check balance** for services with a balance API and **I added credits** for services that only learned from a failed run.

## For provider authors

Declare `"balanceCheck": true` in `provider.json` and export `checkBalance({ configuration, signal })`. Return `{ state: "known", amount, unit }` or `{ state: "unknown", reason }`. The check must be read-only and fast; it runs with a ten-second limit and its errors are redacted like connection checks. Discovery never calls it.
