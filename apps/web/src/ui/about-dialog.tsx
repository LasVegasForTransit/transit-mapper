import { currentBuildInfo, type BuildInfo } from '../build-info';
import { Modal } from './Modal';
import { PROJECT_PROVENANCE } from './about-provenance';

interface AboutDialogProps {
  onClose: () => void;
  buildInfo?: BuildInfo;
}

interface ExternalLinkProps {
  href: string;
  children: string;
}

function ExternalLink({ href, children }: ExternalLinkProps) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function formatBuildTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function AboutDialog({ onClose, buildInfo = currentBuildInfo() }: AboutDialogProps) {
  const licenseRef = buildInfo.commitSha ?? 'main';

  return (
    <Modal
      title="About TransitMapper"
      description="Project credits, build identity, and release provenance for TransitMapper."
      onClose={onClose}
      className="about-modal"
    >
      <div className="about-body">
        <section className="about-section">
          <h3>Developer</h3>
          <ExternalLink href={PROJECT_PROVENANCE.developer.url}>
            {PROJECT_PROVENANCE.developer.name}
          </ExternalLink>
        </section>

        <section className="about-section">
          <h3>Core contributors</h3>
          {PROJECT_PROVENANCE.coreContributors.map((contributor) => (
            <div className="about-contributor" key={contributor.name}>
              <strong>{contributor.name}</strong>
              <span>{contributor.role}</span>
            </div>
          ))}
        </section>

        <section className="about-section">
          <h3>Build</h3>
          <dl className="about-build">
            <dt>Version</dt>
            <dd>{buildInfo.version}</dd>
            <dt>Revision</dt>
            <dd>
              {buildInfo.commitUrl && buildInfo.commitSha ? (
                <ExternalLink href={buildInfo.commitUrl}>
                  {buildInfo.commitSha.slice(0, 7)}
                </ExternalLink>
              ) : (
                'Revision unavailable'
              )}
            </dd>
            <dt>Last updated</dt>
            <dd>
              <time dateTime={buildInfo.builtAt}>{formatBuildTime(buildInfo.builtAt)}</time>
            </dd>
          </dl>
          {buildInfo.dirty && <p className="about-build-note">Local changes included</p>}
          {buildInfo.releaseTag && buildInfo.releaseUrl && (
            <p className="about-release-links">
              <ExternalLink
                href={buildInfo.releaseUrl}
              >{`${buildInfo.releaseTag} release`}</ExternalLink>
              <span aria-hidden="true"> · </span>
              <ExternalLink href={buildInfo.attestationsUrl}>Build attestations</ExternalLink>
            </p>
          )}
        </section>

        <footer className="about-foot">
          <p>
            Map rendering by{' '}
            <ExternalLink href={PROJECT_PROVENANCE.platformCredits[0].url}>
              {PROJECT_PROVENANCE.platformCredits[0].label}
            </ExternalLink>
            , basemap by{' '}
            <ExternalLink href={PROJECT_PROVENANCE.platformCredits[1].url}>
              {PROJECT_PROVENANCE.platformCredits[1].label}
            </ExternalLink>
            , map data ©{' '}
            <ExternalLink href={PROJECT_PROVENANCE.platformCredits[2].url}>
              {PROJECT_PROVENANCE.platformCredits[2].label}
            </ExternalLink>
            , and typography set in{' '}
            <ExternalLink href={PROJECT_PROVENANCE.platformCredits[3].url}>
              {PROJECT_PROVENANCE.platformCredits[3].label}
            </ExternalLink>
            .
          </p>
          <p>
            <ExternalLink href={`${buildInfo.repositoryUrl}/blob/${licenseRef}/LICENSE`}>
              MIT License
            </ExternalLink>
            <span aria-hidden="true"> · </span>
            {buildInfo.copyrightNotice}
          </p>
        </footer>
      </div>
    </Modal>
  );
}
