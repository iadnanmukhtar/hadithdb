# Reader reflections and replies

A reflection attaches a discussion to a specific library item or article. The widget can appear inside a reading page or an ayah dialog.

## Using the feature

| Function | What the reader sees and does | How it works |
| --- | --- | --- |
| Read discussion | A compact reflection action opens the discussion beneath the source or inside the active dialog. Entries carry author and reply context. | The server first resolves the target type. A report, TOC heading, generic content item and blog post use different target identities even if their numbers match. |
| Contribute | Signed-in readers can submit a reflection, reply or vote. Editing and removal appear where authorized. Cancel reply returns to the main input. | The shared reflection router handles reads, authenticated create/update/delete and votes. Adapters validate their target and associate the comment with the appropriate source. |
| Follow activity | An eligible reflection can appear in the Community stream and trigger a notification with a link back to context. | Activity and notifications reference the stored source. The reader’s email preferences apply to delivery. Community post discussion also has its own endpoints. |

## Following a request

On an ayah with reflections, open the thread in the ayah context, choose Reply on an entry and check the reply target before writing. The same shared widget is included on a blog article, but the blog adapter resolves an article identity instead of a hadith ID.

## Earlier desktop and phone captures

These links open the archived route atlas. The URL identifies the original capture, including any redirect or gated state it encountered.

| Screen | Requested URL | Desktop | Phone |
| --- | --- | --- |
| Reflection action · sign-in feedback | `/quran:2:255` | [Wide](../../design-system/screens/reflections-wide.jpg) | [Narrow](../../design-system/screens/reflections-small.jpg) |

## Implementation and related reading

- Reader discussion widget. [views/sub-views/comment_widget.ejs](../../../views/sub-views/comment_widget.ejs)
- Shared operations and authentication. [routes/reflections.js](../../../routes/reflections.js)
- Source item and heading adapter. [routes/comments.js](../../../routes/comments.js)
- Blog adapter. [routes/blogComments.js](../../../routes/blogComments.js)
- Reader likes. [routes/likes.js](../../../routes/likes.js)
- Community representation. [lib/CommunityReflections.js](../../../lib/CommunityReflections.js)

Related guides · [Community feeds, profiles and interactions](../community/README.md) · [Email subscriptions and in-app alerts](../notifications/README.md)

[All features](../README.md)
