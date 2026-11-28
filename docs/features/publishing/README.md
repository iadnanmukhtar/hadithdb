# Community writing, articles and blog

Authors can write a short post or a longer article, preview it and publish a version for others to read. The blog also exposes public article archives and feeds.

## Using the feature

| Function | What the reader sees and does | How it works |
| --- | --- | --- |
| Start writing | Write prompts signed-out visitors to sign in. The editor appears after the account resolves. Article controls include title, subtitle, cover, Markdown formatting and preview. | The authenticated writer loads its draft state. A notebook import reads the selected note as a copy. Editing a draft and publishing its public fields are separate operations. |
| Revise and publish | Draft status and publishing controls sit with the writing area. Available maintenance actions include conversion, unpublishing and deletion. | New and existing posts use separate create/update endpoints. Publication state and moderation determine what readers see. Updates use post identity. Deletion includes a version. |
| Read a post or article | Short posts emphasize the text and actions. A full article can have a cover, author rail and contents rail. At narrow widths the title, updated date and status stay with the reading column. | Canonical Community links use a GUID. Old handle/ID links resolve to it. Public rendering uses published fields. The shared Markdown renderer formats the article and preserves section links. |
| Add media and share | The editor accepts a cover and embedded media. Readers can open images or share a post link with a preview. | Upload and link-preview endpoints prepare media. Public image routes and source previews use stored identities. The shared content title supplies a fallback for a post without an authored title. |
| Browse blog and feeds | The blog lists article cards, opens title-based article URLs, and offers Atom and RSS to feed readers. | The blog router dispatches list, attachments, detail and feed separately. Imported blog entries retain their slug. The optional Drive copy feature writes a Markdown copy on publication updates. |

## Following a request

To revise an existing article, open its editor, change the draft and preview the result before publishing. A saved draft, a public article page and a subscriber’s email are three separate outputs. A stored draft alone does not imply that the public version changed or a notification was sent.

## Earlier desktop and phone captures

These links open the archived route atlas. The URL identifies the original capture, including any redirect or gated state it encountered.

| Screen | Requested URL | Desktop | Phone |
| --- | --- | --- |
| Article editor · signed out | `/community/write` | [Wide](../../design-system/screens/compose-wide.jpg) | [Narrow](../../design-system/screens/compose-small.jpg) |
| Individual Community post | `/community/@i.adnan.mukhtar/2032` | [Wide](../../design-system/screens/post-wide.jpg) | [Narrow](../../design-system/screens/post-small.jpg) |
| Community article | `/community/p/64a936a0-39b3-4bc9-a2ee-10fff93f10cf` | [Wide](../../design-system/screens/community-story-wide.jpg) | [Narrow](../../design-system/screens/community-story-small.jpg) |
| Blog archive | `/blog` | [Wide](../../design-system/screens/articles-wide.jpg) | [Narrow](../../design-system/screens/articles-small.jpg) |
| Blog article | `/blog/Iddah%20and%20Mourning` | [Wide](../../design-system/screens/article-wide.jpg) | [Narrow](../../design-system/screens/article-small.jpg) |

## Implementation and related reading

- Drafts, import, preview, publishing and identity. [routes/community.js](../../../routes/community.js)
- Writer lifecycle and publication controls. [public/static/js/community.js](../../../public/static/js/community.js)
- Short-post composition. [public/static/js/community-short-editor.js](../../../public/static/js/community-short-editor.js)
- Article archive, title URLs, attachments, Atom and RSS. [routes/blog.js](../../../routes/blog.js)
- Full article and supporting rails. [views/blog_post.ejs](../../../views/blog_post.ejs)
- Permanent Community addresses. [lib/CommunityPostIdentity.js](../../../lib/CommunityPostIdentity.js)
- Optional outbound Markdown copies. [lib/CommunityDrive.js](../../../lib/CommunityDrive.js)
- Community implementation notes. [COMMUNITY.md](../../../COMMUNITY.md)

Related guides · [Community feeds, profiles and interactions](../community/README.md) · [Email subscriptions and in-app alerts](../notifications/README.md) · [ActivityPub federation](../federation/README.md) · [Formatted writing and bilingual typography](../formatted-content/README.md)

[All features](../README.md)
