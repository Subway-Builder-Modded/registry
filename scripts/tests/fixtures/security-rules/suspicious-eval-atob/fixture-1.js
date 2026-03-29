export function triggerEvalAtob() {
  const encoded = "Y29uc29sZS5sb2coJ3Rlc3QnKQ==";
  return eval(atob(encoded));
}
