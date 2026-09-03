export type ContentRef =
  | {
      kind: 'transit-system';
      id: string;
      revision: { kind: 'latest' } | { kind: 'pinned'; systemRevisionId: string };
    }
  | {
      kind: 'transit-dataset';
      id: string;
      revision:
        | {
            kind: 'latest';
            operational: { kind: 'planned' } | { kind: 'latest' };
          }
        | {
            kind: 'pinned';
            datasetRevisionId: string;
            operational:
              | { kind: 'planned' }
              | { kind: 'latest' }
              | { kind: 'pinned'; operationalSnapshotId: string };
          };
    };
