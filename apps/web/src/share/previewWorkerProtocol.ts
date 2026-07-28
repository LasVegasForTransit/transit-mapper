export interface PreviewWorkerRequest {
  /** System JSON already produced for the share request. Sending the string
   * avoids structured-cloning the complete RTC graph into the Worker. */
  data: string;
}

export interface PreviewWorkerSuccess {
  kind: 'done';
  markup: string;
}

export interface PreviewWorkerFailure {
  kind: 'error';
  message: string;
}

export type PreviewWorkerEvent = PreviewWorkerSuccess | PreviewWorkerFailure;
