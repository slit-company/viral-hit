---
name: publish-and-measure
description: Publish a finished version to a connected destination with explicit approval, record its performance and turn the result into the next brief.
---

# Publish and learn

Publishing puts something public under the user's name. Never publish without an explicit yes for the exact post.

1. **Prepare.** Choose the exported version and a connected destination from `viral_hit_publication_list`. Draft the title, caption, hashtags and schedule in the user's voice. Each version you publish should differ in one clear way (hook, first frame, caption) so results can be compared.
2. **Approve.** Show the video, destination account, caption and time together. Send with `viral_hit_publication_change` only after the user approves that exact bundle; any change needs a new approval.
3. **Confirm delivery.** Wait for the delivery receipt. A timeout is not a failure and never a reason to post again; read the publication status first.
4. **Measure.** After a fair interval (for example 24 hours and 7 days), record readings with `viral_hit_performance_change` or read collected ones with `viral_hit_performance_read`. Keep a missing number missing, never zero.
5. **Learn.** Compare versions on retention, views and engagement, say which difference most likely mattered and how sure you are, and write the next brief for `hit-remake` or `batch-variations`.

