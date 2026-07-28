// frontend/src/components/wizard/Step1Topic.js
/**
 * Step 1 — topic and title.
 *
 * The topic input writes two columns: `topic`, which is prose the generator reads,
 * and `seo_keywords`, which is the primary keyword every score is measured
 * against. They are the same string here on purpose — asking for both separately
 * on the first screen of a six-step wizard gets one of them filled in wrongly, and
 * an author who really does want them to differ can split them in the editor.
 *
 * The chosen title re-scores as it is typed, debounced. That score is computed
 * locally; see titleScore.js for why, and for the endpoint that should replace it.
 */

import { useMemo, useState } from 'react';

import { generateApi } from '../../lib/api';
import { ARTICLE_TYPE_LABELS } from '../../lib/constants';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import Button from '../ui/Button';
import { Input, TagInput } from '../ui/form';
import { Card, CardHeader, ErrorBanner, InfoBanner } from '../ui/feedback';
import SeoScoreBreakdown from './SeoScoreBreakdown';
import TitleSuggestions from './TitleSuggestions';
import { scoreTitle } from './titleScore';

/** How many suggestions to ask for. The spec's range is 3–5. */
const TITLE_COUNT = 5;

export default function Step1Topic({ config, onChange }) {
  const [suggestions, setSuggestions] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);

  const topic = config.topic || '';
  const title = config.blog_title || '';

  // 400ms: long enough that a fast typist scores once per word rather than once
  // per letter, short enough that the number does not feel detached from the text.
  const debouncedTitle = useDebouncedValue(title, 400);
  const debouncedKeyword = useDebouncedValue(config.seo_keywords || '', 400);

  const liveScore = useMemo(
    () =>
      debouncedTitle.trim() === ''
        ? null
        : scoreTitle(debouncedTitle, { keyword: debouncedKeyword || topic }),
    // `topic` only matters as the keyword fallback, and it is debounced through
    // seo_keywords in practice, so it is safe as a plain dependency.
    [debouncedTitle, debouncedKeyword, topic]
  );

  async function handleGenerate() {
    if (generating || topic.trim() === '') return;

    setGenerating(true);
    setError(null);
    try {
      const result = await generateApi.titles({
        topic: topic.trim(),
        keyword: (config.seo_keywords || topic).trim(),
        secondary_keywords: config.secondary_keywords || [],
        article_type: config.article_type,
        readability_level: config.readability_level,
        language: config.language,
        target_country: config.target_country || undefined,
        count: TITLE_COUNT,
      });

      const titles = Array.isArray(result?.titles) ? result.titles : [];
      if (titles.length === 0) {
        // Not an exception on the wire, so it would otherwise render as an empty
        // list that looks like nothing happened.
        setError({
          message: 'The provider returned no usable titles. Try again, or write one yourself.',
          code: 'NO_TITLES',
        });
      }
      setSuggestions(titles);
    } catch (err) {
      setError(err);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="What is the article about?"
          subtitle="The primary keyword drives the title score, the outline and the images."
        />
        <div className="space-y-4 p-5">
          <Input
            label="Primary keyword or topic"
            required
            value={topic}
            onChange={(event) =>
              // Both columns move together — see the note at the top of the file.
              onChange({ topic: event.target.value, seo_keywords: event.target.value })
            }
            placeholder="mercury retrograde in virgo"
            hint="One phrase, the way a reader would search for it."
            maxLength={255}
          />

          <TagInput
            label="Secondary keywords"
            value={config.secondary_keywords || []}
            onChange={(value) => onChange({ secondary_keywords: value })}
            placeholder="retrograde dates, communication problems"
            max={20}
            hint="Optional long-tail terms. Press Enter to add. Up to 20."
          />

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleGenerate}
              loading={generating}
              disabled={topic.trim() === ''}
            >
              {generating ? 'Asking the model' : 'Generate title suggestions'}
            </Button>
            <p className="text-xs text-ink-muted">
              {`Suggests ${TITLE_COUNT} ${ARTICLE_TYPE_LABELS[config.article_type] || 'article'} titles, each scored.`}
            </p>
          </div>

          <ErrorBanner error={error} onRetry={handleGenerate} onDismiss={() => setError(null)} />

          <TitleSuggestions
            suggestions={suggestions}
            selected={title}
            onSelect={(suggestion) => onChange({ blog_title: suggestion.title })}
          />
        </div>
      </Card>

      <Card glow>
        <CardHeader
          title="Title"
          subtitle="Edit freely — the score updates as you type."
        />
        <div className="space-y-4 p-5">
          <Input
            label="Article title"
            required
            value={title}
            onChange={(event) => onChange({ blog_title: event.target.value })}
            placeholder="Mercury Retrograde in Virgo: What It Actually Affects"
            maxLength={255}
            hint={`${title.length} of 255 characters used.`}
          />

          {liveScore ? (
            // A named region, not a bare div: it is the one part of this step that
            // changes on its own as the author types, so it has to be findable and
            // announceable as a unit rather than as loose text after the input.
            <section aria-labelledby="live-title-score">
              <p id="live-title-score" className="mb-2 text-xs font-medium text-ink-secondary">
                Live SEO score for this title
              </p>
              <SeoScoreBreakdown seo={liveScore} />
            </section>
          ) : (
            <InfoBanner tone="neutral">
              Pick a suggestion above or type a title, and its score appears here with the
              reasoning behind every point.
            </InfoBanner>
          )}
        </div>
      </Card>
    </div>
  );
}
