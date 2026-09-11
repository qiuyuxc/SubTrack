import { reactive } from 'vue';

/** Single shared instance of the create/edit subscription dialog. */
export const dialogState = reactive({
  open: false,
  editing: null,
});

export function openSubscriptionDialog(subscription = null) {
  dialogState.editing = subscription;
  dialogState.open = true;
}

export function closeSubscriptionDialog() {
  dialogState.open = false;
  dialogState.editing = null;
}
