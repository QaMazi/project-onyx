document.addEventListener("DOMContentLoaded", () => {
  const generateButton = document.getElementById("generateNumberButton");
  const minValueInput = document.getElementById("minValue");
  const maxValueInput = document.getElementById("maxValue");
  const resultDisplay = document.getElementById("rngResult");
  const errorDisplay = document.getElementById("rngError");

  if (!generateButton || !minValueInput || !maxValueInput || !resultDisplay || !errorDisplay) {
    return;
  }

  generateButton.addEventListener("click", () => {
    const minValue = Number(minValueInput.value);
    const maxValue = Number(maxValueInput.value);

    errorDisplay.textContent = "";

    if (minValueInput.value === "" || maxValueInput.value === "") {
      resultDisplay.textContent = "--";
      errorDisplay.textContent = "Please enter both a minimum and maximum number.";
      return;
    }

    if (!Number.isInteger(minValue) || !Number.isInteger(maxValue)) {
      resultDisplay.textContent = "--";
      errorDisplay.textContent = "Please enter valid whole numbers.";
      return;
    }

    if (minValue > maxValue) {
      resultDisplay.textContent = "--";
      errorDisplay.textContent = "Minimum number cannot be greater than maximum number.";
      return;
    }

    const result = Math.floor(Math.random() * (maxValue - minValue + 1)) + minValue;
    resultDisplay.textContent = result;
  });
});