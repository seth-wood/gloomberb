import { Box, Text, TextAttributes } from "../../../ui";
import { colors } from "../../../theme/colors";
import { t, tf } from "../../../i18n";
import type { BrokerAdapter } from "../../../types/broker";
import { ExternalLink, type ListViewItem } from "../../ui";
import { getBrokerLabel } from "./utils";

export function BrokerSetupPanel({
  choices,
  selectedBrokerId,
  brokerValues,
  adapter,
}: {
  choices: ListViewItem[];
  selectedBrokerId: string;
  brokerValues: Record<string, Record<string, string>>;
  adapter: BrokerAdapter | null;
}) {
  const brokerLabel = getBrokerLabel(choices, selectedBrokerId);
  const guide = adapter?.getSetupGuide?.(brokerValues[selectedBrokerId] ?? {}) ?? null;

  return (
    <Box flexDirection="column" paddingX={2}>
      <Box height={1}>
        <Text fg={colors.textBright} attributes={TextAttributes.BOLD}>
          {tf("Setup Guide - {broker}", { broker: brokerLabel })}
        </Text>
      </Box>
      <Box height={1} />

      {guide ? (
        <>
          <Box height={1}>
            <Text fg={colors.textDim}>{guide.intro}</Text>
          </Box>
          <Box height={2} />
          {guide.steps.map((step) => (
            <Box height={1} key={step}>
              <Text fg={colors.textDim}>{step}</Text>
            </Box>
          ))}
          {guide.docsUrl ? (
            <>
              <Box height={2} />
              <ExternalLink url={guide.docsUrl} />
            </>
          ) : null}
        </>
      ) : (
        <>
          <Box height={1}>
            <Text fg={colors.textDim}>{tf("You'll need your {broker} API credentials.", { broker: brokerLabel })}</Text>
          </Box>
          <Box height={1}>
            <Text fg={colors.textDim}>{t("Check your broker's documentation for setup instructions.")}</Text>
          </Box>
        </>
      )}

      <Box height={2} />
    </Box>
  );
}
