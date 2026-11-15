use anyhow::{Result, bail};

pub fn calculate(input: &str) -> Result<Option<String>> {
    let input = input.trim().trim_start_matches('=');
    if input.len() > 512 {
        bail!("Expression is too long");
    }
    if input.is_empty() || !input.chars().any(|c| c.is_ascii_digit()) {
        return Ok(None);
    }
    if input
        .chars()
        .any(|c| !(c.is_ascii_alphanumeric() || c.is_whitespace() || ".+-*/%^(),π×÷".contains(c)))
    {
        return Ok(None);
    }
    let mut parser = Parser {
        chars: input.chars().collect(),
        pos: 0,
        depth: 0,
    };
    let value = parser.expression(0)?;
    parser.space();
    if parser.pos != parser.chars.len() {
        bail!("Complete the expression");
    }
    if !value.is_finite() {
        bail!("Result is undefined");
    }
    let result = format!("{value:.10}");
    let result = result.trim_end_matches('0').trim_end_matches('.');
    Ok(Some(if result == "-0" { "0" } else { result }.to_string()))
}
const FUNCTIONS: [&str; 12] = [
    "sqrt", "sin", "cos", "tan", "ln", "log", "abs", "round", "floor", "ceil", "pi", "e",
];
/// Whether `input` reads as a calculation rather than a search: it starts
/// like an expression and every word in it is a known function or constant.
fn is_expression(input: &str) -> bool {
    let input = input.trim_start();
    let input = input.strip_prefix('=').unwrap_or(input).trim_start();
    let starts = input
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_digit() || c.is_alphabetic() || ".(-+π".contains(c));
    starts
        && input.len() <= 512
        && input.chars().any(|c| c.is_ascii_digit())
        && input
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c.is_whitespace() || ".+-*/%^(),π×÷".contains(c))
        && input
            .split(|c: char| !c.is_ascii_alphabetic())
            .all(|word| word.is_empty() || FUNCTIONS.contains(&word))
}
/// Inserts thousands separators into the integer part of every number.
/// Commas already between digits are dropped and regrouped; the fraction
/// and every other character are kept as typed.
fn group_numbers(input: &str) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len() + input.len() / 3);
    let mut i = 0;
    while i < chars.len() {
        if !chars[i].is_ascii_digit() {
            out.push(chars[i]);
            i += 1;
            continue;
        }
        let mut digits = String::new();
        while i < chars.len() {
            if chars[i].is_ascii_digit() {
                digits.push(chars[i]);
            } else if !(chars[i] == ',' && chars.get(i + 1).is_some_and(|c| c.is_ascii_digit())) {
                break;
            }
            i += 1;
        }
        out.push_str(&group(&digits));
        if chars.get(i) == Some(&'.') {
            out.push('.');
            i += 1;
            while chars.get(i).is_some_and(|c| c.is_ascii_digit()) {
                out.push(chars[i]);
                i += 1;
            }
        }
    }
    out
}
fn group(digits: &str) -> String {
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (index, digit) in digits.chars().enumerate() {
        if index > 0 && (digits.len() - index).is_multiple_of(3) {
            out.push(',');
        }
        out.push(digit);
    }
    out
}
/// The calculation in `input` with thousands separators, when that differs
/// from what was typed. Searches are left alone.
pub fn group_input(input: &str) -> Option<String> {
    if !is_expression(input) {
        return None;
    }
    let grouped = group_numbers(input);
    (grouped != input).then_some(grouped)
}
/// `input` without the separators [`group_input`] adds, so other providers
/// still match the digits the user typed (a file named `20240115`, an app
/// called `2048`).
pub fn ungroup(input: &str) -> std::borrow::Cow<'_, str> {
    if !is_expression(input) || !input.contains(',') {
        return input.into();
    }
    let chars: Vec<char> = input.chars().collect();
    chars
        .iter()
        .enumerate()
        .filter(|&(i, c)| {
            !(*c == ','
                && i > 0
                && chars[i - 1].is_ascii_digit()
                && chars.get(i + 1).is_some_and(|c| c.is_ascii_digit()))
        })
        .map(|(_, c)| *c)
        .collect::<String>()
        .into()
}
/// Where a cursor at char offset `cursor` in `text` belongs in `grouped`:
/// after the same digit, whatever separators moved around it.
pub fn regrouped_cursor(text: &str, cursor: usize, grouped: &str) -> usize {
    let before = text.chars().take(cursor).filter(|c| *c != ',').count();
    if before == 0 {
        return 0;
    }
    grouped
        .chars()
        .enumerate()
        .filter(|(_, c)| *c != ',')
        .nth(before - 1)
        .map_or(grouped.chars().count(), |(i, _)| i + 1)
}
/// A result from [`calculate`] as shown to the user, with thousands separators.
pub fn display(value: &str) -> String {
    group_numbers(value)
}
struct Parser {
    chars: Vec<char>,
    pos: usize,
    depth: usize,
}
impl Parser {
    fn space(&mut self) {
        while self.chars.get(self.pos).is_some_and(|c| c.is_whitespace()) {
            self.pos += 1;
        }
    }
    fn take(&mut self, ch: char) -> bool {
        self.space();
        if self.chars.get(self.pos) == Some(&ch) {
            self.pos += 1;
            true
        } else {
            false
        }
    }
    /// A comma between digits of a number's integer part groups thousands.
    fn separator(&self) -> bool {
        self.chars.get(self.pos) == Some(&',')
            && self.pos > 0
            && self.chars[self.pos - 1].is_ascii_digit()
            && self
                .chars
                .get(self.pos + 1)
                .is_some_and(|c| c.is_ascii_digit())
            && !self.chars[..self.pos]
                .iter()
                .rev()
                .take_while(|c| c.is_ascii_digit() || **c == ',' || **c == '.')
                .any(|c| *c == '.')
    }
    fn expression(&mut self, min: u8) -> Result<f64> {
        self.depth += 1;
        if self.depth > 64 {
            bail!("Expression is too deeply nested");
        }
        self.space();
        let mut lhs = if self.take('-') {
            -self.expression(3)?
        } else if self.take('+') {
            self.expression(3)?
        } else if self.take('(') {
            let n = self.expression(0)?;
            if !self.take(')') {
                bail!("Missing closing parenthesis");
            }
            n
        } else if self.chars.get(self.pos).is_some_and(|c| c.is_alphabetic()) {
            let start = self.pos;
            while self.chars.get(self.pos).is_some_and(|c| c.is_alphabetic()) {
                self.pos += 1;
            }
            let name: String = self.chars[start..self.pos].iter().collect();
            if name == "pi" || name == "π" {
                std::f64::consts::PI
            } else if name == "e" {
                std::f64::consts::E
            } else {
                if !self.take('(') {
                    bail!("Expected function argument");
                }
                let n = self.expression(0)?;
                if !self.take(')') {
                    bail!("Missing closing parenthesis");
                }
                match name.as_str() {
                    "sqrt" => n.sqrt(),
                    "sin" => n.sin(),
                    "cos" => n.cos(),
                    "tan" => n.tan(),
                    "ln" => n.ln(),
                    "log" => n.log10(),
                    "abs" => n.abs(),
                    "round" => n.round(),
                    "floor" => n.floor(),
                    "ceil" => n.ceil(),
                    _ => bail!("Unknown function"),
                }
            }
        } else {
            let start = self.pos;
            while self
                .chars
                .get(self.pos)
                .is_some_and(|c| c.is_ascii_digit() || *c == '.')
                || self.separator()
            {
                self.pos += 1;
            }
            if start == self.pos {
                bail!("Enter a number");
            }
            self.chars[start..self.pos]
                .iter()
                .filter(|c| **c != ',')
                .collect::<String>()
                .parse::<f64>()?
        };
        loop {
            self.space();
            if self.chars.get(self.pos) == Some(&'%') {
                lhs /= 100.;
                self.pos += 1;
                continue;
            }
            let op = self.chars.get(self.pos).copied().unwrap_or('\0');
            let (left, right) = match op {
                '+' | '-' => (1, 2),
                '*' | '/' | '×' | '÷' => (2, 3),
                '^' => (4, 4),
                _ => break,
            };
            if left < min {
                break;
            }
            self.pos += 1;
            let rhs = self.expression(right)?;
            lhs = match op {
                '+' => lhs + rhs,
                '-' => lhs - rhs,
                '*' | '×' => lhs * rhs,
                '/' | '÷' => lhs / rhs,
                '^' => lhs.powf(rhs),
                _ => unreachable!(),
            };
        }
        self.depth -= 1;
        Ok(lhs)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn precedence_and_functions() {
        for (expr, value) in [
            ("2+3*4", "14"),
            ("(2+3)*4", "20"),
            ("2^3^2", "512"),
            ("-2^2", "-4"),
            ("200*15%", "30"),
            ("sqrt(81)", "9"),
            ("0", "0"),
        ] {
            assert_eq!(calculate(expr).unwrap().as_deref(), Some(value), "{expr}");
        }
    }
    #[test]
    fn rejects_invalid_and_executable_input() {
        assert!(calculate("1/0").is_err());
        assert!(calculate("sqrt(-1)").is_err());
        assert!(calculate("2+").is_err());
        assert!(calculate("process.exit(1)").is_err());
        assert_eq!(calculate("Files").unwrap(), None);
        assert!(calculate("1.5,000").is_err());
        assert!(calculate("1,").is_err());
    }
    #[test]
    fn thousands_separators() {
        for (expr, value) in [
            ("1,234 + 1", "1235"),
            ("1,234,567.5 * 2", "2469135"),
            ("12,34", "1234"),
            ("sqrt(1,000,000)", "1000"),
        ] {
            assert_eq!(calculate(expr).unwrap().as_deref(), Some(value), "{expr}");
        }
        for (value, shown) in [
            ("0", "0"),
            ("999", "999"),
            ("1000", "1,000"),
            ("-1234567.125", "-1,234,567.125"),
            ("0.0001234", "0.0001234"),
        ] {
            assert_eq!(display(value), shown);
        }
    }
    #[test]
    fn groups_typed_calculations_only() {
        for (typed, grouped) in [
            ("1234", Some("1,234")),
            ("1234567+89.12345", Some("1,234,567+89.12345")),
            ("1,2345", Some("12,345")),
            ("=12345*2", Some("=12,345*2")),
            ("sqrt(10000)", Some("sqrt(10,000)")),
            ("1,234", None),
            ("123", None),
            ("1234,", Some("1,234,")),
            ("2048 game", None),
            ("report 2024", None),
            ("Files", None),
        ] {
            assert_eq!(group_input(typed).as_deref(), grouped, "{typed}");
        }
        assert_eq!(ungroup("1,234 + 5"), "1234 + 5");
        // Typing 9 after "1," in "1,234" lands the cursor after the 9 in "19,234".
        assert_eq!(regrouped_cursor("1,9234", 3, "19,234"), 2);
        assert_eq!(regrouped_cursor("1234", 4, "1,234"), 5);
        assert_eq!(regrouped_cursor("12345+6", 0, "12,345+6"), 0);
        assert_eq!(regrouped_cursor("12345+6", 5, "12,345+6"), 6);
        assert_eq!(ungroup("a,1,2"), "a,1,2");
    }
}
