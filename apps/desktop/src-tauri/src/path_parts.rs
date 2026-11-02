pub(crate) fn safe_name(value:&str)->String {
    let cleaned:String=value.chars().map(|c|if c.is_control()||"/\\:*?\"<>|".contains(c){'-'}else{c}).take(140).collect();
    let cleaned=cleaned.trim_matches(|c|c==' '||c=='.');
    let base=cleaned.split('.').next().unwrap_or("").to_uppercase();
    if cleaned.is_empty(){"Sem nome".into()}else if ["CON","PRN","AUX","NUL","COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8","COM9","LPT1","LPT2","LPT3","LPT4","LPT5","LPT6","LPT7","LPT8","LPT9"].contains(&base.as_str()){format!("_{cleaned}")}else{cleaned.into()}
}
