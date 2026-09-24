const VibrationPattern = {
  // Basic Interactions
  buttonTap: 10,
  release: 30,
  buttonLongPress: 100,
  successConfirm: [50, 30, 50],
  errorAlert: [300, 100, 300],

  scrollFeedback: [15, 10, 15, 10, 15],
} as const;

export default VibrationPattern;
