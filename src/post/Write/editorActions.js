import Promise from 'bluebird';
import assert from 'assert';
import SteemConnect from 'sc2-sdk';
import { push } from 'react-router-redux';
import { createAction } from 'redux-actions';
import { addDraftMetadata, deleteDraftMetadata } from '../../helpers/metadata';
import { jsonParse } from '../../helpers/formatter';
import { createPermlink, getBodyPatchIfSmaller } from '../../vendor/steemitHelpers';

// @UTOPIAN
import { createContribution, updateContribution } from '../../actions/contribution';

export const CREATE_POST = '@editor/CREATE_POST';
export const CREATE_POST_START = '@editor/CREATE_POST_START';
export const CREATE_POST_SUCCESS = '@editor/CREATE_POST_SUCCESS';
export const CREATE_POST_ERROR = '@editor/CREATE_POST_ERROR';

export const NEW_POST = '@editor/NEW_POST';
export const newPost = createAction(NEW_POST);

export const SAVE_DRAFT = '@editor/SAVE_DRAFT';
export const SAVE_DRAFT_START = '@editor/SAVE_DRAFT_START';
export const SAVE_DRAFT_SUCCESS = '@editor/SAVE_DRAFT_SUCCESS';
export const SAVE_DRAFT_ERROR = '@editor/SAVE_DRAFT_ERROR';

export const DELETE_DRAFT = '@editor/DELETE_DRAFT';
export const DELETE_DRAFT_START = '@editor/DELETE_DRAFT_START';
export const DELETE_DRAFT_SUCCESS = '@editor/DELETE_DRAFT_SUCCESS';
export const DELETE_DRAFT_ERROR = '@editor/DELETE_DRAFT_ERROR';

export const ADD_EDITED_POST = '@editor/ADD_EDITED_POST';
export const addEditedPost = createAction(ADD_EDITED_POST);

export const DELETE_EDITED_POST = '@editor/DELETE_EDITED_POST';
export const deleteEditedPost = createAction(DELETE_EDITED_POST);

export const saveDraft = (post, redirect) => dispatch =>
  dispatch({
    type: SAVE_DRAFT,
    payload: {
      promise: addDraftMetadata(post)
        .then((resp) => {
          if (redirect) {
            if (post.projectId && post.type === 'announcement') {
              dispatch(push(`/write-announcement/${post.projectId}/?draft=${post.id}`));
            } else {
              dispatch(push(`/write?draft=${post.id}`));
            }

          }
          return resp;
        }),
    },
    meta: { postId: post.id },
  });

export const deleteDraft = draftId => (dispatch) => {
  dispatch({
    type: DELETE_DRAFT,
    payload: {
      promise: deleteDraftMetadata(draftId),
    },
    meta: { id: draftId },
  });
};

export const editPost = post => (dispatch) => {
  const jsonMetadata = jsonParse(post.json_metadata);
  const draft = {
    ...post,
    originalBody: post.body,
    jsonMetadata,
    isUpdating: true,
  };
  dispatch(saveDraft({ postData: draft, id: post.id }))
    .then(() => {
      if (jsonMetadata.type.indexOf('announcement') > -1) {
        dispatch(push(`/write-announcement/${jsonMetadata.repository.id}?draft=${post.id}`));
      } else {
        dispatch(push(`/write?draft=${post.id}`));
      }
    });
};

const requiredFields = 'parentAuthor,parentPermlink,author,permlink,title,body,jsonMetadata'.split(
  ',',
);

export const broadcastComment = (
  parentAuthor,
  parentPermlink,
  author,
  title,
  body,
  jsonMetadata,
  permlink,
  extensions,
) => {
  const operations = [];

  const commentOp = [
    'comment',
    {
      parent_author: parentAuthor,
      parent_permlink: parentPermlink,
      author,
      permlink,
      title,
      body,
      json_metadata: JSON.stringify(jsonMetadata),
    },
  ];
  operations.push(commentOp);

  const commentOptionsConfig = {
    author,
    permlink,
    allow_votes: true,
    allow_curation_rewards: true,
    extensions,
  };

  // @UTOPIAN here beneficiaries are stored when creating the post
  if (extensions) {
    commentOptionsConfig.extensions = extensions;
  }

  // @UTOPIAN always 100% powered up
  commentOptionsConfig.max_accepted_payout = '1000000.000 SBD';
  commentOptionsConfig.percent_steem_dollars = 0;

  operations.push(['comment_options', commentOptionsConfig]);

  /*
   if (reward === '0') {
   commentOptionsConfig.max_accepted_payout = '0.000 SBD';
   commentOptionsConfig.percent_steem_dollars = 10000;
   } else if (reward === '100') {
   commentOptionsConfig.max_accepted_payout = '1000000.000 SBD';
   commentOptionsConfig.percent_steem_dollars = 0;
   }

   if (reward === '0' || reward === '100') {
   operations.push(['comment_options', commentOptionsConfig]);
   }

   if (upvote) {
   operations.push([
   'vote',
   {
   voter: author,
   author,
   permlink,
   weight: 10000,
   },
   ]);
   }*/

  console.log("OPERATIONS", operations)

  return SteemConnect.broadcast(operations).catch(e => {
    console.log(e);
    alert("Utopian could not communicate with Steem. Please try again later. Your post is saved in the drafts. https://utopian.io/drafts");
  });
};

export function createPost(postData) {
  requiredFields.forEach((field) => {
    assert(postData[field] != null, `Developer Error: Missing required field ${field}`);
  });

  return (dispatch) => {
    const {
      parentAuthor,
      parentPermlink,
      author,
      title,
      body,
      jsonMetadata,
      draftId,
      isUpdating,
      extensions,
    } = postData;

    console.log("POST DATA", postData);

    const getPermLink = isUpdating
      ? Promise.resolve(postData.permlink)
      : createPermlink(title, author, parentAuthor, parentPermlink);

    dispatch({
      type: CREATE_POST,
      payload: {
        promise: getPermLink.then(permlink => {
          const newBody = isUpdating ? getBodyPatchIfSmaller(postData.originalBody, body) : body + `<br /><hr/><em>Open Source Contribution posted via <a href="https://utopian.io/${process.env.UTOPIAN_CATEGORY}/@${author}/${permlink}">Utopian.io</a></em><hr/>`;

          return broadcastComment(
              parentAuthor,
              parentPermlink,
              author,
              title,
              newBody,
              jsonMetadata,
              permlink,
              !isUpdating && extensions,
            ).then((result) => {

              if (draftId) {
                dispatch(deleteDraft(draftId));
                dispatch(addEditedPost(permlink));
              }

              // @UTOPIAN
              if (result) {
                if (!isUpdating) {
                  const createOnAPI = contributionData => dispatch(
                    createContribution(contributionData.author, contributionData.permlink)
                  );
                  createOnAPI({ author, permlink })
                    .then(() => dispatch(
                      push(`/${parentPermlink}/@${author}/${permlink}`)
                    ));
                } else {
                  const updateOnAPI = contributionData => dispatch(
                    updateContribution(contributionData.author, contributionData.permlink)
                  );
                  updateOnAPI({ author, permlink }).then(() => dispatch(
                    push(`/${parentPermlink}/@${author}/${permlink}`)
                  ));
                }
              }

              if (window.ga) {
                window.ga('send', 'event', 'post', 'submit', '', 10);
              }

              return result;
            })
          }
        ),
      },
    });
  };
}
